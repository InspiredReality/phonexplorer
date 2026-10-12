"""
Async Monday.com GraphQL client.

Fetches:
  • All active items/tasks across all boards
  • All item updates posted in the last N days

Usage (standalone):
    MONDAY_API_TOKEN=your_token python -m app.services.monday_client

Usage (as a module):
    from app.services.monday_client import MondayClient
    async with MondayClient(token) as client:
        items   = await client.get_active_items()
        updates = await client.get_recent_updates(days=7)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

MONDAY_API_URL = "https://api.monday.com/v2"
PAGE_DELAY_S   = 0.05
DEFAULT_PAGE_SIZE = 100


# ── GraphQL queries ────────────────────────────────────────────────────────────

ACTIVE_ITEMS_QUERY = """
query GetActiveItems($limit: Int!, $after: String) {
  items_page(
    limit: $limit
    cursor: $after
    query_params: {
      rules: [{ column_id: "status", compare_value: ["1"] }]
    }
  ) {
    cursor
    items {
      id
      name
      state
      created_at
      updated_at
      board { id name }
      group { id title }
      column_values {
        id
        text
        type
        ... on StatusValue   { label }
        ... on DateValue     { date }
        ... on TextValue     { text }
        ... on LongTextValue { text }
        ... on NumbersValue  { number }
      }
      creator { id name email }
    }
  }
}
"""

# Root-level updates query — from_date / to_date filters ONLY work here,
# not when updates is nested inside a boards query (per Monday.com docs).
RECENT_UPDATES_QUERY = """
query GetRecentUpdates($limit: Int!, $page: Int!, $from_date: ISO8601DateTime!, $to_date: ISO8601DateTime!) {
  updates(
    limit: $limit
    page: $page
    from_date: $from_date
    to_date: $to_date
  ) {
    id
    body
    created_at
    updated_at
    item_id
    creator { id name email }
    replies {
      id
      body
      created_at
      creator { id name email }
    }
  }
}
"""

ITEM_NAMES_QUERY = """
query GetItemNames($ids: [ID!]!) {
  items(ids: $ids, limit: 100) {
    id
    name
    board { id name }
  }
}
"""

BOARDS_QUERY = """
query GetBoards($limit: Int!, $page: Int!) {
  boards(limit: $limit, page: $page) {
    id
    name
  }
}
"""

BOARD_COLUMNS_QUERY = """
query GetBoardColumns($boardId: [ID!]!) {
  boards(ids: $boardId) {
    id
    name
    columns {
      id
      title
      type
    }
  }
}
"""

_PROJECT_COLUMN_FIELDS = """
      id
      type
      text
      value
      ... on StatusValue   { label label_style { color } }
      ... on TimelineValue { from to }
      ... on DateValue     { date }
"""

# First page of a board's items, plus its groups (name, colour, order).
BOARD_PROJECT_QUERY = """
query GetBoardProject($boardId: [ID!]!, $limit: Int!) {
  boards(ids: $boardId) {
    id
    name
    groups { id title color }
    items_page(limit: $limit) {
      cursor
      items {
        id
        name
        group { id }
        column_values {%(cols)s}
        subitems {
          id
          name
          column_values {%(cols)s}
        }
      }
    }
  }
}
""" % {"cols": _PROJECT_COLUMN_FIELDS}

NEXT_PROJECT_ITEMS_QUERY = """
query NextProjectItems($limit: Int!, $cursor: String!) {
  next_items_page(limit: $limit, cursor: $cursor) {
    cursor
    items {
      id
      name
      group { id }
      column_values {%(cols)s}
      subitems {
        id
        name
        column_values {%(cols)s}
      }
    }
  }
}
""" % {"cols": _PROJECT_COLUMN_FIELDS}

# Board-level Activity log. Status changes are the `update_column_value` events
# whose data carries a status column (type "color") with old/new labels.
ACTIVITY_LOGS_QUERY = """
query GetActivityLogs($boardId: [ID!]!, $from: ISO8601DateTime!, $to: ISO8601DateTime!, $limit: Int!, $page: Int!) {
  boards(ids: $boardId) {
    id
    name
    activity_logs(from: $from, to: $to, limit: $limit, page: $page) {
      id
      event
      data
      created_at
      user_id
    }
  }
}
"""

BOARD_UPDATES_QUERY = """
query GetBoardUpdates($boardId: [ID!]!, $limit: Int!) {
  boards(ids: $boardId) {
    updates(limit: $limit) {
      id
      body
      created_at
      item_id
      creator { id name email }
      replies { id body created_at creator { id name email } }
    }
  }
}
"""

CREATE_TAG_MUTATION = """
mutation CreateTag($tagName: String!, $boardId: ID!) {
  create_or_get_tag(tag_name: $tagName, board_id: $boardId) {
    id
    name
  }
}
"""

USERS_QUERY = """
query GetUsers { users { id name } }
"""

CREATE_ITEM_MUTATION = """
mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: JSON) {
  create_item(
    board_id: $boardId
    item_name: $itemName
    column_values: $columnValues
  ) {
    id
    name
  }
}
"""


# ── Client ─────────────────────────────────────────────────────────────────────

class MondayClient:
    """
    Async Monday.com GraphQL client backed by a shared httpx.AsyncClient.

    Can be used as an async context manager:
        async with MondayClient(token) as c:
            items = await c.get_active_items()

    Or as a plain object (call .aclose() when done):
        c = MondayClient(token)
        items = await c.get_active_items()
        await c.aclose()
    """

    def __init__(self, token: str | None = None) -> None:
        self._token = token or os.environ["MONDAY_API_TOKEN"]
        self._http = httpx.AsyncClient(
            base_url=MONDAY_API_URL,
            headers={
                "Authorization": self._token,
                "Content-Type": "application/json",
                "API-Version": "2024-01",
            },
            timeout=httpx.Timeout(30.0),
        )

    async def __aenter__(self) -> "MondayClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    # ── Low-level ────────────────────────────────────────────────────────────

    async def _gql(self, query: str, variables: dict | None = None) -> dict:
        payload: dict[str, Any] = {"query": query}
        if variables:
            payload["variables"] = variables

        resp = await self._http.post("", json=payload)
        resp.raise_for_status()

        body = resp.json()
        if "errors" in body:
            raise RuntimeError(f"Monday GraphQL errors: {body['errors']}")

        return body["data"]

    # ── Active items ──────────────────────────────────────────────────────────

    async def get_active_items(self, page_size: int = DEFAULT_PAGE_SIZE) -> list[dict]:
        items: list[dict] = []
        cursor: str | None = None

        while True:
            try:
                data = await self._gql(ACTIVE_ITEMS_QUERY, {"limit": page_size, "after": cursor})
            except RuntimeError as exc:
                log.warning("Status-rule query failed (%s). Using state filter fallback.", exc)
                data = await self._gql_all_items_fallback(page_size, cursor)

            page = data.get("items_page", {})
            items.extend(page.get("items", []))
            cursor = page.get("cursor")
            log.info("Fetched %d items so far (cursor=%s)", len(items), cursor)

            if not cursor:
                break
            await asyncio.sleep(PAGE_DELAY_S)

        return [i for i in items if i.get("state") != "archived"]

    async def _gql_all_items_fallback(self, page_size: int, cursor: str | None) -> dict:
        query = """
        query GetAllItems($limit: Int!, $after: String) {
          items_page(limit: $limit, cursor: $after) {
            cursor
            items {
              id name state created_at updated_at
              board { id name }
              group { id title }
              column_values { id text type }
              creator { id name email }
            }
          }
        }
        """
        return await self._gql(query, {"limit": page_size, "after": cursor})

    # ── Recent updates ────────────────────────────────────────────────────────

    async def get_recent_updates(self, days: int = 7, page_size: int = 100) -> list[dict]:
        """
        Return all updates posted within the last `days` days.

        Per Monday.com docs: date-range filters are ONLY supported at the
        root `updates` level — not when updates is nested inside `boards`.
        """
        to_dt   = datetime.now(timezone.utc)
        from_dt = to_dt - timedelta(days=days)

        from_date = from_dt.strftime("%Y-%m-%d")
        to_date   = to_dt.strftime("%Y-%m-%d")

        log.info("Fetching updates from %s to %s", from_date, to_date)

        all_updates: list[dict] = []
        page = 1

        while True:
            data = await self._gql(
                RECENT_UPDATES_QUERY,
                {"limit": page_size, "page": page, "from_date": from_date, "to_date": to_date},
            )
            batch = data.get("updates", [])
            log.info("Page %d: got %d updates", page, len(batch))
            all_updates.extend(batch)

            if len(batch) < page_size:
                break

            page += 1
            await asyncio.sleep(PAGE_DELAY_S)

        item_meta = await self._fetch_item_meta(
            list({u["item_id"] for u in all_updates if u.get("item_id")})
        )

        for update in all_updates:
            meta = item_meta.get(str(update.get("item_id")), {})
            update["_item_name"] = meta.get("name", "—")
            update["_board"]     = meta.get("board")

        all_updates.sort(key=lambda u: u.get("created_at", ""), reverse=True)
        return all_updates

    async def get_status_changes(
        self,
        days: int = 7,
        max_boards: int = 50,
        page_size: int = 100,
        max_pages: int = 5,
    ) -> list[dict]:
        """
        Return status-column changes from the boards' Activity logs in the last
        `days` days, newest first:

            {id, timestamp (ISO), item_id, item_name, board: {id, name},
             column, from_status, to_status, user}

        A board whose activity log can't be read is skipped, not fatal.
        """
        to_dt = datetime.now(timezone.utc)
        from_dt = to_dt - timedelta(days=days)
        variables = {
            "from": from_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "to": to_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "limit": page_size,
        }

        boards = (await self._gql(BOARDS_QUERY, {"limit": max_boards, "page": 1})).get("boards", [])
        try:
            users = {
                str(u["id"]): u["name"]
                for u in (await self._gql(USERS_QUERY)).get("users", [])
            }
        except RuntimeError:
            users = {}

        changes: list[dict] = []
        for board in boards:
            changes.extend(await self._board_status_changes(board, users, variables, page_size, max_pages))
            await asyncio.sleep(PAGE_DELAY_S)

        changes.sort(key=lambda c: c["timestamp"], reverse=True)
        return changes

    async def _board_status_changes(
        self, board: dict, users: dict[str, str], variables: dict, page_size: int, max_pages: int
    ) -> list[dict]:
        """Status changes from one board's activity log. A failing board yields []."""
        changes: list[dict] = []
        for page in range(1, max_pages + 1):
            try:
                data = await self._gql(
                    ACTIVITY_LOGS_QUERY, {**variables, "boardId": [board["id"]], "page": page}
                )
            except RuntimeError as exc:
                log.warning("Activity log fetch failed for board %s: %s", board["id"], exc)
                break
            logs = (data.get("boards") or [{}])[0].get("activity_logs") or []
            for entry in logs:
                change = _parse_status_change(entry, board, users)
                if change:
                    changes.append(change)
            if len(logs) < page_size:
                break
            await asyncio.sleep(PAGE_DELAY_S)
        return changes

    async def get_board_activity(self, customer: str, days: int = 30) -> dict | None:
        """
        Updates and status changes for one customer's board (same shapes as
        get_recent_updates / get_status_changes), or None if no board matches.
        """
        board = await self.find_board_by_customer(customer)
        if not board:
            return None

        to_dt = datetime.now(timezone.utc)
        from_dt = to_dt - timedelta(days=days)
        variables = {
            "from": from_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "to": to_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "limit": 100,
        }
        try:
            users = {
                str(u["id"]): u["name"]
                for u in (await self._gql(USERS_QUERY)).get("users", [])
            }
        except RuntimeError:
            users = {}

        changes = await self._board_status_changes(board, users, variables, 100, 5)
        changes.sort(key=lambda c: c["timestamp"], reverse=True)

        # Board updates have no server-side date filter, so cut off client-side.
        data = await self._gql(BOARD_UPDATES_QUERY, {"boardId": [board["id"]], "limit": 100})
        raw = (data.get("boards") or [{}])[0].get("updates") or []
        cutoff = from_dt
        updates = [u for u in raw if (_parse_dt(u.get("created_at")) or to_dt) >= cutoff]
        meta = await self._fetch_item_meta(list({u["item_id"] for u in updates if u.get("item_id")}))
        for u in updates:
            m = meta.get(str(u.get("item_id")), {})
            u["_item_name"] = m.get("name", "—")
            u["_board"] = {"id": board["id"], "name": board["name"]}
        updates.sort(key=lambda u: u.get("created_at", ""), reverse=True)

        return {
            "board": {"id": board["id"], "name": board["name"]},
            "days": days,
            "updates": updates,
            "status_changes": changes,
        }

    async def _fetch_item_meta(self, item_ids: list[str], batch_size: int = 50) -> dict[str, dict]:
        meta: dict[str, dict] = {}
        for i in range(0, len(item_ids), batch_size):
            batch = item_ids[i : i + batch_size]
            try:
                data = await self._gql(ITEM_NAMES_QUERY, {"ids": batch})
                for item in data.get("items", []):
                    meta[str(item["id"])] = {"name": item.get("name", "—"), "board": item.get("board")}
            except RuntimeError as exc:
                log.warning("Item meta fetch failed for batch (%s); retrying one by one", exc)
                for item_id in batch:
                    try:
                        data = await self._gql(ITEM_NAMES_QUERY, {"ids": [item_id]})
                        for item in data.get("items", []):
                            meta[str(item["id"])] = {"name": item.get("name", "—"), "board": item.get("board")}
                    except RuntimeError:
                        log.warning("Item meta fetch failed for item %s", item_id)
            await asyncio.sleep(PAGE_DELAY_S)
        return meta

    # ── Item creation ─────────────────────────────────────────────────────────

    async def find_board_by_name(self, name: str, page_size: int = 100, max_pages: int = 20) -> dict | None:
        """Case-insensitive lookup of a board by exact name. Returns {"id", "name"} or None."""
        target = name.strip().lower()
        for page in range(1, max_pages + 1):
            data = await self._gql(BOARDS_QUERY, {"limit": page_size, "page": page})
            boards = data.get("boards", [])
            for board in boards:
                if board["name"].strip().lower() == target:
                    return board
            if len(boards) < page_size:
                break
            await asyncio.sleep(PAGE_DELAY_S)
        return None

    async def find_board_by_customer(self, customer: str, page_size: int = 100, max_pages: int = 20) -> dict | None:
        """
        Find a customer's project board. Prefers an exact (case-insensitive)
        name match, then falls back to the first board whose name contains
        the customer string.
        """
        target = customer.strip().lower()
        partial: dict | None = None
        for page in range(1, max_pages + 1):
            data = await self._gql(BOARDS_QUERY, {"limit": page_size, "page": page})
            boards = data.get("boards", [])
            for board in boards:
                name = board["name"].strip().lower()
                if name == target:
                    return board
                if partial is None and target in name:
                    partial = board
            if len(boards) < page_size:
                break
            await asyncio.sleep(PAGE_DELAY_S)
        return partial

    async def get_project_board(self, customer: str, page_size: int = DEFAULT_PAGE_SIZE) -> dict | None:
        """
        Return a customer's project board as nested groups -> tasks -> subtasks:

            {"board": {id, name}, "groups": [{id, title, color, tasks: [
                {id, name, status, status_color, timeline, subtasks: [...]}]}]}

        Returns None if no board matches the customer name.
        """
        found = await self.find_board_by_customer(customer)
        if not found:
            return None

        data = await self._gql(BOARD_PROJECT_QUERY, {"boardId": [found["id"]], "limit": page_size})
        board = data["boards"][0]
        page = board.get("items_page") or {}
        items = list(page.get("items", []))
        cursor = page.get("cursor")
        while cursor:
            await asyncio.sleep(PAGE_DELAY_S)
            nxt = (await self._gql(NEXT_PROJECT_ITEMS_QUERY, {"limit": page_size, "cursor": cursor}))["next_items_page"]
            items.extend(nxt.get("items", []))
            cursor = nxt.get("cursor")

        groups = [
            {"id": g["id"], "title": g["title"], "color": g.get("color"), "tasks": []}
            for g in board.get("groups", [])
        ]
        by_id = {g["id"]: g for g in groups}
        for item in items:
            group = by_id.get((item.get("group") or {}).get("id"))
            if group is None:
                continue
            task = _shape_task(item)
            task["subtasks"] = [_shape_task(s) for s in item.get("subitems") or []]
            group["tasks"].append(task)

        return {"board": {"id": board["id"], "name": board["name"]}, "groups": groups}

    async def get_raw_items(self, customer: str, name_contains: str, page_size: int = DEFAULT_PAGE_SIZE) -> dict | None:
        """
        Raw column values (before shaping) for items and subitems on a customer's
        board whose name contains `name_contains`. For checking how Monday
        reports milestones, tags, etc. Returns None if no board matches.
        """
        found = await self.find_board_by_customer(customer)
        if not found:
            return None
        data = await self._gql(BOARD_PROJECT_QUERY, {"boardId": [found["id"]], "limit": page_size})
        page = data["boards"][0].get("items_page") or {}
        items = list(page.get("items", []))
        cursor = page.get("cursor")
        while cursor:
            await asyncio.sleep(PAGE_DELAY_S)
            nxt = (await self._gql(NEXT_PROJECT_ITEMS_QUERY, {"limit": page_size, "cursor": cursor}))["next_items_page"]
            items.extend(nxt.get("items", []))
            cursor = nxt.get("cursor")

        needle = name_contains.strip().lower()
        matches = []
        for item in items:
            for candidate in [item, *(item.get("subitems") or [])]:
                if needle in candidate["name"].lower():
                    matches.append(candidate)
        return {"board": {"id": found["id"], "name": found["name"]}, "matches": matches}

    async def get_board_columns(self, board_id: str) -> list[dict]:
        """Return [{"id", "title", "type"}, ...] for the given board."""
        data = await self._gql(BOARD_COLUMNS_QUERY, {"boardId": [board_id]})
        boards = data.get("boards", [])
        return boards[0]["columns"] if boards else []

    async def create_item(
        self, board_id: str, item_name: str, column_values: dict[str, Any] | None = None
    ) -> dict:
        """Create an item on a board. column_values keys are column IDs (not titles)."""
        variables: dict[str, Any] = {"boardId": board_id, "itemName": item_name}
        if column_values:
            # Monday's `column_values` argument is typed JSON but the API expects
            # an escaped JSON *string*, not a raw object, even when passed as a
            # GraphQL variable.
            variables["columnValues"] = json.dumps(column_values)
        data = await self._gql(CREATE_ITEM_MUTATION, variables)
        return data["create_item"]

    async def _column_value(self, board_id: str, column_type: str, value: str) -> Any:
        """Shape a plain string into the JSON structure Monday expects for a column type."""
        if column_type in ("color", "status"):
            return {"label": value}
        if column_type == "dropdown":
            return {"labels": [value]}
        if column_type == "tag":
            # Tag columns take tag IDs, so find or create the tag first.
            tag = (await self._gql(CREATE_TAG_MUTATION, {"tagName": value, "boardId": board_id}))["create_or_get_tag"]
            return {"tag_ids": [int(tag["id"])]}
        return value  # text, long_text, ...

    async def create_item_by_board_name(
        self,
        board_name: str,
        item_name: str,
        field_values: dict[str, str] | None = None,
    ) -> dict:
        """
        Create an item on a board looked up by name, mapping human-readable
        field names (matched case-insensitively against column titles, e.g.
        "Customer", "Technology") to the board's actual column IDs.

        Fields that don't match any column on the board are silently skipped
        so this stays resilient to board layout changes.
        """
        board = await self.find_board_by_name(board_name)
        if not board:
            raise LookupError(f'Monday board "{board_name}" not found')

        column_values: dict[str, Any] = {}
        if field_values:
            columns = await self.get_board_columns(board["id"])
            columns_by_title = {c["title"].strip().lower(): c for c in columns}
            for field_name, value in field_values.items():
                if not value:
                    continue
                column = columns_by_title.get(field_name.strip().lower())
                if not column:
                    log.warning(
                        'No column titled "%s" found on board "%s" — skipping',
                        field_name, board_name,
                    )
                    continue
                column_values[column["id"]] = await self._column_value(board["id"], column["type"], value)

        item = await self.create_item(board["id"], item_name, column_values)
        item["board"] = board
        return item


# ── Utilities ──────────────────────────────────────────────────────────────────

def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _activity_ts(created_at: str | int | None) -> str | None:
    """Activity log timestamps are 17-digit Unix time in 1/10 microseconds."""
    try:
        raw = int(created_at)
    except (TypeError, ValueError):
        return None
    seconds = raw / 1e7 if raw > 1e14 else raw
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()


def _parse_status_change(entry: dict, board: dict, users: dict[str, str]) -> dict | None:
    """Turn one activity-log entry into a status change, or None if it isn't one."""
    if entry.get("event") != "update_column_value":
        return None
    try:
        data = json.loads(entry["data"]) if isinstance(entry.get("data"), str) else entry.get("data") or {}
    except ValueError:
        return None
    if data.get("column_type") not in ("color", "status"):
        return None

    def label(key: str) -> str | None:
        return ((data.get(key) or {}).get("label") or {}).get("text")

    timestamp = _activity_ts(entry.get("created_at"))
    if not timestamp:
        return None
    return {
        "id": str(entry["id"]),
        "timestamp": timestamp,
        "item_id": str(data.get("pulse_id") or ""),
        "item_name": data.get("pulse_name") or "—",
        "board": {"id": board["id"], "name": board["name"]},
        "column": data.get("column_title") or "Status",
        "from_status": label("previous_value"),
        "to_status": label("value"),
        "user": users.get(str(entry.get("user_id"))),
    }


def _shape_task(item: dict) -> dict:
    """
    Flatten an item's column values into the fields the UI shows: status,
    timeline, tags (names, without the leading "#") and whether the Timeline
    column is set to display as a milestone.
    """
    task: dict[str, Any] = {
        "id": item["id"], "name": item["name"],
        "status": None, "status_color": None, "timeline": None,
        "milestone": False, "tags": [],
    }
    fallback_date: dict | None = None
    has_timeline_column = any(c.get("type") in ("timeline", "timerange") for c in item.get("column_values") or [])
    for col in item.get("column_values") or []:
        kind = col.get("type")
        if kind in ("status", "color") and task["status"] is None:
            task["status"] = col.get("label") or col.get("text") or None
            task["status_color"] = (col.get("label_style") or {}).get("color")
        elif kind in ("timeline", "timerange"):
            # Only a Timeline column can be a milestone, and an empty one ("-") has no dates.
            start = col.get("from")
            if start and task["timeline"] is None:
                task["timeline"] = {"from": start, "to": col.get("to") or start}
                task["milestone"] = _is_milestone_value(col.get("value"))
        elif kind == "date" and fallback_date is None and col.get("date"):
            fallback_date = {"from": col["date"], "to": col["date"]}
        elif kind in ("tag", "tags"):  # Monday names the Tags column type "tag"
            task["tags"].extend(
                t.strip().lstrip("#").strip()
                for t in (col.get("text") or "").split(",")
                if t.strip()
            )
    # An empty Timeline stays empty ("-" in Monday); a plain Date column is never
    # shown in its place, unless the item has no Timeline column at all.
    if task["timeline"] is None and not has_timeline_column:
        task["timeline"] = fallback_date
    return task


def _is_milestone_value(raw: Any) -> bool:
    """A Timeline column set to "milestone" carries visualization_type in its value JSON."""
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return False
    return isinstance(value, dict) and value.get("visualization_type") == "milestone"


# ── CLI entry-point ────────────────────────────────────────────────────────────

async def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")

    token = os.environ.get("MONDAY_API_TOKEN")
    if not token:
        raise SystemExit("Set MONDAY_API_TOKEN in your environment or backend/.env")

    async with MondayClient(token) as c:
        print("\n── Active Items ──────────────────────────────────")
        items = await c.get_active_items()
        print(f"Total active items: {len(items)}")
        print(json.dumps(items[:3], indent=2, default=str))

        print("\n── Updates (last 7 days) ─────────────────────────")
        updates = await c.get_recent_updates(days=7)
        print(f"Total recent updates: {len(updates)}")
        print(json.dumps(updates[:3], indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(_main())

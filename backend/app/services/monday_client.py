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
  items(ids: $ids) {
    id
    name
    board { id name }
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

    async def _fetch_item_meta(self, item_ids: list[str], batch_size: int = 50) -> dict[str, dict]:
        meta: dict[str, dict] = {}
        for i in range(0, len(item_ids), batch_size):
            batch = item_ids[i : i + batch_size]
            try:
                data = await self._gql(ITEM_NAMES_QUERY, {"ids": batch})
                for item in data.get("items", []):
                    meta[str(item["id"])] = {"name": item.get("name", "—"), "board": item.get("board")}
            except RuntimeError as exc:
                log.warning("Item meta fetch failed for batch: %s", exc)
            await asyncio.sleep(PAGE_DELAY_S)
        return meta


# ── Utilities ──────────────────────────────────────────────────────────────────

def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


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

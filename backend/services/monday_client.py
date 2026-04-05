"""
monday_client.py
────────────────
Async Monday.com GraphQL client.

Fetches:
  • All active items/tasks across all boards
  • All item updates posted in the last 7 days

Usage (standalone):
    MONDAY_API_TOKEN=your_token python monday_client.py

Usage (as a module):
    from services.monday_client import MondayClient
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
# Monday.com uses query-complexity limits, not plain rate limits.
# 50 ms sleep between paginated requests keeps us well inside limits.
PAGE_DELAY_S = 0.05
DEFAULT_PAGE_SIZE = 100  # max Monday allows per items_page call


# ── GraphQL queries ────────────────────────────────────────────────────────────

# Fetches one page of active items across all boards.
# `after` is the cursor for the next page (None for first page).
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
      board {
        id
        name
      }
      group {
        id
        title
      }
      column_values {
        id
        text
        type
        ... on StatusValue   { label }
        ... on DateValue     { date }
        ... on PeopleValue   { persons_and_teams { id kind } }
        ... on TextValue     { text }
        ... on LongTextValue { text }
        ... on NumbersValue  { number }
      }
      creator {
        id
        name
        email
      }
    }
  }
}
"""

# Fetches updates (comments / activity) for a batch of item IDs.
# We filter client-side by created_at >= cutoff after fetching.
ITEM_UPDATES_QUERY = """
query GetItemUpdates($ids: [ID!]!, $limit: Int!) {
  items(ids: $ids) {
    id
    name
    board { id name }
    updates(limit: $limit) {
      id
      body
      created_at
      updated_at
      creator {
        id
        name
        email
      }
      replies {
        id
        body
        created_at
        creator { id name email }
      }
    }
  }
}
"""

# Lighter query: fetch just item IDs for all active items (used when we only
# need IDs to batch-load updates without pulling full column values twice).
ACTIVE_ITEM_IDS_QUERY = """
query GetActiveItemIds($limit: Int!, $after: String) {
  items_page(
    limit: $limit
    cursor: $after
    query_params: {
      rules: [{ column_id: "status", compare_value: ["1"] }]
    }
  ) {
    cursor
    items { id }
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
                "API-Version": "2024-01",   # Monday stable version header
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
        """Execute a GraphQL query, raise on HTTP or GraphQL errors."""
        payload: dict[str, Any] = {"query": query}
        if variables:
            payload["variables"] = variables

        resp = await self._http.post("", json=payload)
        resp.raise_for_status()

        body = resp.json()
        if "errors" in body:
            raise RuntimeError(f"Monday GraphQL errors: {body['errors']}")

        return body["data"]

    # ── Public helpers ────────────────────────────────────────────────────────

    async def get_active_items(
        self,
        page_size: int = DEFAULT_PAGE_SIZE,
    ) -> list[dict]:
        """
        Return all active items across every board, paginating automatically.
        'Active' = items whose Status column value is not 'Done' / 'Archived'.
        Monday's `items_page` with the status rule handles the server-side filter.
        """
        items: list[dict] = []
        cursor: str | None = None

        while True:
            variables = {"limit": page_size, "after": cursor}
            try:
                data = await self._gql(ACTIVE_ITEMS_QUERY, variables)
            except RuntimeError as exc:
                # Monday returns an error if the status rule column doesn't
                # exist on some boards — fall back to fetching all and
                # filtering by item.state == "active".
                log.warning(
                    "Status-rule query failed (%s). Falling back to state filter.", exc
                )
                data = await self._gql_all_items_fallback(page_size, cursor)

            page = data.get("items_page", {})
            items.extend(page.get("items", []))
            cursor = page.get("cursor")

            log.info("Fetched %d items so far (cursor=%s)", len(items), cursor)

            if not cursor:
                break

            await asyncio.sleep(PAGE_DELAY_S)

        # Secondary filter: keep only truly active states
        return [i for i in items if i.get("state") != "archived"]

    async def _gql_all_items_fallback(
        self, page_size: int, cursor: str | None
    ) -> dict:
        """Fallback: fetch all items (no status filter) and let caller filter."""
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

    async def get_recent_updates(
        self,
        days: int = 7,
        updates_per_item: int = 50,
        batch_size: int = 50,
    ) -> list[dict]:
        """
        Return all updates posted within the last `days` days.

        Strategy:
          1. Collect all active item IDs (lightweight query).
          2. Batch them into groups of `batch_size` and query updates.
          3. Filter updates whose created_at >= cutoff.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        log.info("Fetching updates since %s", cutoff.isoformat())

        # Step 1: gather all item IDs
        item_ids = await self._get_all_active_ids()
        log.info("Found %d active items to check for updates", len(item_ids))

        # Step 2 & 3: batch fetch updates and filter by date
        recent: list[dict] = []

        for i in range(0, len(item_ids), batch_size):
            batch = item_ids[i : i + batch_size]
            data = await self._gql(
                ITEM_UPDATES_QUERY,
                {"ids": batch, "limit": updates_per_item},
            )
            for item in data.get("items", []):
                for update in item.get("updates", []):
                    created = _parse_dt(update.get("created_at"))
                    if created and created >= cutoff:
                        recent.append({**update, "_item_id": item["id"], "_item_name": item["name"], "_board": item.get("board")})

            log.info(
                "Processed batch %d–%d, %d recent updates so far",
                i,
                i + len(batch),
                len(recent),
            )
            await asyncio.sleep(PAGE_DELAY_S)

        recent.sort(key=lambda u: u.get("created_at", ""), reverse=True)
        return recent

    async def _get_all_active_ids(
        self, page_size: int = DEFAULT_PAGE_SIZE
    ) -> list[str]:
        """Return just the IDs of all active items (faster, lower complexity)."""
        ids: list[str] = []
        cursor: str | None = None

        while True:
            try:
                data = await self._gql(
                    ACTIVE_ITEM_IDS_QUERY, {"limit": page_size, "after": cursor}
                )
            except RuntimeError:
                # Fallback: fetch all IDs without status filter
                data = await self._gql(
                    """
                    query($limit: Int!, $after: String) {
                      items_page(limit: $limit, cursor: $after) {
                        cursor
                        items { id state }
                      }
                    }
                    """,
                    {"limit": page_size, "after": cursor},
                )

            page = data.get("items_page", {})
            ids.extend(
                i["id"]
                for i in page.get("items", [])
                if i.get("state") != "archived"
            )
            cursor = page.get("cursor")
            if not cursor:
                break
            await asyncio.sleep(PAGE_DELAY_S)

        return ids


# ── Utilities ──────────────────────────────────────────────────────────────────

def _parse_dt(value: str | None) -> datetime | None:
    """Parse an ISO-8601 string from Monday into a timezone-aware datetime."""
    if not value:
        return None
    try:
        # Monday returns strings like "2024-04-01T12:00:00+00:00" or with Z
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


# ── CLI entry-point ────────────────────────────────────────────────────────────

async def _main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
    )

    token = os.environ.get("MONDAY_API_TOKEN")
    if not token:
        raise SystemExit(
            "Set MONDAY_API_TOKEN in your environment or backend/.env file."
        )

    async with MondayClient(token) as client:
        print("\n── Active Items ──────────────────────────────────")
        items = await client.get_active_items()
        print(f"Total active items: {len(items)}")
        print(json.dumps(items[:3], indent=2, default=str))  # preview first 3

        print("\n── Updates (last 7 days) ─────────────────────────")
        updates = await client.get_recent_updates(days=7)
        print(f"Total recent updates: {len(updates)}")
        print(json.dumps(updates[:3], indent=2, default=str))  # preview first 3


if __name__ == "__main__":
    asyncio.run(_main())

"""
Monday.com router  –  /api/monday/...

Exposes the monday_client as REST endpoints for the React frontend.
Requires MONDAY_API_TOKEN in environment / .env.
"""
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from services.monday_client import MondayClient

router = APIRouter(prefix="/api/monday", tags=["monday"])


def _client() -> MondayClient:
    token = os.environ.get("MONDAY_API_TOKEN")
    if not token:
        raise HTTPException(
            status_code=503,
            detail="MONDAY_API_TOKEN not configured on the server.",
        )
    return MondayClient(token)


@router.get("/health")
async def monday_health() -> dict:
    return {"status": "ok"}


@router.get("/active-items")
async def active_items() -> dict[str, Any]:
    """Return all active tasks across all Monday boards."""
    async with _client() as c:
        items = await c.get_active_items()
    return {"count": len(items), "items": items}


@router.get("/recent-updates")
async def recent_updates(
    days: int = Query(default=7, ge=1, le=90),
) -> dict[str, Any]:
    """Return all item updates from the last N days (default 7)."""
    async with _client() as c:
        updates = await c.get_recent_updates(days=days)
    return {"count": len(updates), "days": days, "updates": updates}

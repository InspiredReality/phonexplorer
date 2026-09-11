"""
Monday.com router  –  /api/monday/...

Exposes the monday_client as REST endpoints for the React frontend.
Requires MONDAY_API_TOKEN in environment / .env.
"""
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.monday_client import MondayClient

router = APIRouter(prefix="/api/monday", tags=["monday"])

PRIORITIZED_IMPLEMENTATION_BOARD = "Prioritized Implementation Tasks"


class CreateTaskRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    customer: str = ""
    technology: str = ""


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
async def recent_updates(days: int = Query(default=7, ge=1, le=90)) -> dict[str, Any]:
    """Return all item updates from the last N days (default 7)."""
    async with _client() as c:
        updates = await c.get_recent_updates(days=days)
    return {"count": len(updates), "days": days, "updates": updates}


@router.post("/prioritized-implementation-tasks", status_code=201)
async def create_prioritized_implementation_task(body: CreateTaskRequest) -> dict[str, Any]:
    """
    Create an item on the "Prioritized Implementation Tasks" board — the same
    board the Slack `/monday-item` command posts to — with Customer/Technology
    set on whichever columns are titled that on the board.
    """
    async with _client() as c:
        try:
            item = await c.create_item_by_board_name(
                PRIORITIZED_IMPLEMENTATION_BOARD,
                item_name=body.name,
                field_values={"Customer": body.customer, "Technology": body.technology},
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=f"Monday API error: {exc}") from exc
    return {"item": item}

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.models.bet_entry import BetEntry

router = APIRouter(prefix="/api/bets", tags=["bets"])


class BetEntryUpdate(BaseModel):
    pick: str | None = None
    status: str | None = Field(default=None, pattern="^(pending|won|loss)$")


def _entry_dict(entry: BetEntry) -> dict:
    return {"pick": entry.pick or "", "status": entry.status or "pending"}


@router.get("")
async def list_bet_entries(db: AsyncSession = Depends(get_db)):
    """Every saved pick/status, reshaped into { week1: { teamId: {pick, status} }, ... }."""
    rows = await db.execute(select(BetEntry))
    entries: dict[str, dict[str, dict]] = {}
    for row in rows.scalars().all():
        entries.setdefault(f"week{row.week}", {})[row.team_id] = _entry_dict(row)
    return {"entries": entries}


@router.put("/{week}/{team_id}")
async def upsert_bet_entry(
    week: int, team_id: str, body: BetEntryUpdate, db: AsyncSession = Depends(get_db)
):
    """Save a single cell's pick text and/or status, creating it if it doesn't exist yet."""
    entry = await db.scalar(
        select(BetEntry).where(BetEntry.week == week, BetEntry.team_id == team_id)
    )
    if not entry:
        entry = BetEntry(week=week, team_id=team_id)
        db.add(entry)
    if body.pick is not None:
        entry.pick = body.pick
    if body.status is not None:
        entry.status = body.status
    await db.commit()
    await db.refresh(entry)
    return {"week": week, "team_id": team_id, **_entry_dict(entry)}

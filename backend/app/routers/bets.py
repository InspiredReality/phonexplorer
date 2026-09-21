from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import get_db
from app.models.bet_admin import BetSeasonConfig, BetWeekLock
from app.models.bet_entry import BetEntry

router = APIRouter(prefix="/api/bets", tags=["bets"])

WEEK_COUNT = 15
# NFL weeks run Thu-Mon; "active week" advances every Tuesday. Evaluated in
# US Eastern so a Monday-night game finishing late doesn't flip the week
# over from the server's UTC clock hours before it actually ends locally.
EASTERN = ZoneInfo("America/New_York")
DEFAULT_SEASON_START = date(2026, 9, 8)  # a Tuesday — adjust via the admin page, no deploy needed


def _require_admin(authorization: str | None = Header(default=None)):
    if not settings.admin_token or authorization != f"Bearer {settings.admin_token}":
        raise HTTPException(status_code=401, detail="Unauthorized")


class BetEntryUpdate(BaseModel):
    pick: str | None = None
    status: str | None = Field(default=None, pattern="^(pending|won|loss)$")


class SeasonConfigUpdate(BaseModel):
    season_start: date | None = None
    forced_active_week: int | None = Field(default=None, ge=1, le=WEEK_COUNT)
    # forced_active_week=None is ambiguous with "leave it alone", so clearing
    # back to full-auto needs its own explicit flag.
    clear_forced_active_week: bool = False


class WeekLockUpdate(BaseModel):
    locked: bool


def _entry_dict(entry: BetEntry) -> dict:
    return {"pick": entry.pick or "", "status": entry.status or "pending"}


def _compute_active_week(season_start: date, forced: int | None, today: date) -> int:
    if forced is not None:
        return max(1, min(WEEK_COUNT, forced))
    if today < season_start:
        return 1
    weeks_elapsed = (today - season_start).days // 7
    return max(1, min(WEEK_COUNT, weeks_elapsed + 1))


async def _get_or_create_season_config(db: AsyncSession) -> BetSeasonConfig:
    cfg = await db.get(BetSeasonConfig, 1)
    if not cfg:
        cfg = BetSeasonConfig(id=1, season_start=DEFAULT_SEASON_START, forced_active_week=None)
        db.add(cfg)
        await db.commit()
        await db.refresh(cfg)
    return cfg


def _season_dict(cfg: BetSeasonConfig) -> dict:
    today = datetime.now(EASTERN).date()
    return {
        "season_start": cfg.season_start.isoformat(),
        "forced_active_week": cfg.forced_active_week,
        "active_week": _compute_active_week(cfg.season_start, cfg.forced_active_week, today),
        "week_count": WEEK_COUNT,
    }


@router.get("")
async def list_bet_entries(db: AsyncSession = Depends(get_db)):
    """Everything the page needs in one call: picks/status, per-week locks, and season/visibility info."""
    rows = await db.execute(select(BetEntry))
    entries: dict[str, dict[str, dict]] = {}
    for row in rows.scalars().all():
        entries.setdefault(f"week{row.week}", {})[row.team_id] = _entry_dict(row)

    lock_rows = await db.execute(select(BetWeekLock))
    locks = {f"week{row.week}": row.locked for row in lock_rows.scalars().all()}

    cfg = await _get_or_create_season_config(db)

    return {"entries": entries, "locks": locks, "season": _season_dict(cfg)}


@router.put("/season")
async def update_season_config(
    body: SeasonConfigUpdate, db: AsyncSession = Depends(get_db), _: None = Depends(_require_admin)
):
    cfg = await _get_or_create_season_config(db)
    if body.season_start is not None:
        cfg.season_start = body.season_start
    if body.clear_forced_active_week:
        cfg.forced_active_week = None
    elif body.forced_active_week is not None:
        cfg.forced_active_week = body.forced_active_week
    await db.commit()
    await db.refresh(cfg)
    return _season_dict(cfg)


@router.put("/{week}/lock")
async def set_week_lock(
    week: int, body: WeekLockUpdate, db: AsyncSession = Depends(get_db), _: None = Depends(_require_admin)
):
    lock = await db.get(BetWeekLock, week)
    if not lock:
        lock = BetWeekLock(week=week, locked=body.locked)
        db.add(lock)
    else:
        lock.locked = body.locked
    await db.commit()
    return {"week": week, "locked": body.locked}


@router.put("/{week}/{team_id}")
async def upsert_bet_entry(
    week: int, team_id: str, body: BetEntryUpdate, db: AsyncSession = Depends(get_db)
):
    """Save a single cell's pick text and/or status, creating it if it doesn't exist yet."""
    lock = await db.get(BetWeekLock, week)
    if lock and lock.locked:
        raise HTTPException(status_code=423, detail="This week is locked and can no longer be edited")

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

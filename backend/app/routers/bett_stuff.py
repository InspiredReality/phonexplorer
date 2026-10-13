import json
from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.models.bett_stuff_settlement import BettStuffSettlement

router = APIRouter(prefix="/api/bett-stuff", tags=["bett-stuff"])

# No accounts yet — every row belongs to this single placeholder user until
# the app grows real auth.
DEFAULT_USER_ID = "default"


class SettlementUpsert(BaseModel):
    bet_date: date
    pick: str = ""
    notes: str | None = None
    image: str | None = None
    bet_amount: float = 0
    to_win: float = 0
    profit: float = 0
    sportsbook: str | None = None
    tags: list[str] = []
    status: str
    result: str


def _dict(row: BettStuffSettlement, include_image: bool = True) -> dict:
    try:
        tags = json.loads(row.tags) if row.tags else []
    except ValueError:
        tags = []
    return {
        "id": row.id,
        "bet_date": row.bet_date.isoformat(),
        "pick": row.pick,
        "notes": row.notes,
        "image": row.image if include_image else None,
        "has_image": bool(row.image),
        "bet_amount": row.bet_amount,
        "to_win": row.to_win,
        "profit": row.profit,
        "sportsbook": row.sportsbook,
        "tags": tags,
        "status": row.status,
        "result": row.result,
    }


@router.get("/settlements")
async def list_settlements(db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(BettStuffSettlement).where(BettStuffSettlement.user_id == DEFAULT_USER_ID)
        )
    ).scalars().all()
    # Screenshots are base64 and dominate the payload; the list leaves them
    # out (see has_image) and clients fetch each one from /image on demand.
    return [_dict(row, include_image=False) for row in rows]


@router.get("/settlements/{row_id}/image")
async def get_settlement_image(row_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(BettStuffSettlement, row_id)
    return {"image": row.image if row else None}


@router.put("/settlements/{row_id}")
async def upsert_settlement(row_id: str, body: SettlementUpsert, db: AsyncSession = Depends(get_db)):
    """Create or update a bet, keyed by the panel row's own id.

    Every edit calls this, regardless of status or result — the database is
    the source of truth on load, so the frontend writes through on every
    change rather than waiting for a bet to be Closed.
    """
    row = await db.get(BettStuffSettlement, row_id)
    if not row:
        row = BettStuffSettlement(id=row_id, user_id=DEFAULT_USER_ID)
        db.add(row)
    row.bet_date = body.bet_date
    row.pick = body.pick
    row.notes = body.notes
    # A null image means "not sent" (clients that haven't loaded the
    # screenshot yet), never "clear it" — there is no remove-image action.
    if body.image is not None:
        row.image = body.image
    row.bet_amount = body.bet_amount
    row.to_win = body.to_win
    row.profit = body.profit
    row.sportsbook = body.sportsbook
    row.tags = json.dumps(body.tags)
    row.status = body.status
    row.result = body.result
    await db.commit()
    await db.refresh(row)
    return _dict(row, include_image=False)


@router.delete("/settlements/{row_id}")
async def delete_settlement(row_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(BettStuffSettlement, row_id)
    if row:
        await db.delete(row)
        await db.commit()
    return {"deleted": True}

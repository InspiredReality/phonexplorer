import json
import re
from datetime import date

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
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


def _list_dict(row) -> dict:
    try:
        tags = json.loads(row["tags"]) if row["tags"] else []
    except ValueError:
        tags = []
    return {
        "id": row["id"],
        "bet_date": row["bet_date"].isoformat(),
        "pick": row["pick"],
        "notes": row["notes"],
        "image": None,
        "has_image": bool(row["has_image"]),
        "bet_amount": row["bet_amount"],
        "to_win": row["to_win"],
        "profit": row["profit"],
        "sportsbook": row["sportsbook"],
        "tags": tags,
        "status": row["status"],
        "result": row["result"],
    }


@router.get("/settlements")
async def list_settlements(db: AsyncSession = Depends(get_db)):
    # Screenshots are base64 and dominate the payload — and selecting the
    # image column would make Postgres read every one of them off disk even
    # if we never serialized them. So it's left out of the query entirely
    # (has_image is computed in SQL) and clients fetch each from /image.
    cols = [c for c in BettStuffSettlement.__table__.columns if c.name != "image"]
    has_image = and_(BettStuffSettlement.image.is_not(None), BettStuffSettlement.image != "")
    rows = (
        await db.execute(
            select(*cols, has_image.label("has_image")).where(
                BettStuffSettlement.user_id == DEFAULT_USER_ID
            )
        )
    ).mappings().all()
    return [_list_dict(row) for row in rows]


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


class SlipImage(BaseModel):
    image: str  # data URL


SLIP_PROMPT = (
    "This is a screenshot of a sports bet slip. Reply with ONLY a JSON object "
    '{"bet": <number|null>, "to_win": <number|null>}. "bet" is the amount staked '
    '(Wager/Risk/Stake). "to_win" is the TOTAL payout if the bet wins — stake '
    'plus profit (labelled To Pay/Payout/Total Payout/Returns). If the slip only '
    'shows profit ("To Win"), add the stake to it. Use plain numbers without '
    "currency symbols; use null for anything you cannot read."
)


def _money(value) -> float | None:
    try:
        number = float(str(value).replace("$", "").replace(",", ""))
    except (TypeError, ValueError):
        return None
    return round(number, 2) if number >= 0 else None


@router.post("/read-slip")
async def read_slip(body: SlipImage):
    """Reads Bet and To Win off a bet-slip screenshot with a vision model."""
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Slip reading is not configured")
    match = re.match(r"data:(image/[\w.+-]+);base64,(.+)", body.image, re.DOTALL)
    if not match:
        raise HTTPException(status_code=400, detail="Expected a base64 image data URL")
    media_type, data = match.groups()

    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": settings.slip_model,
                "max_tokens": 100,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}},
                            {"type": "text", "text": SLIP_PROMPT},
                        ],
                    }
                ],
            },
        )
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail="Slip reader unavailable")
    text = "".join(b.get("text", "") for b in res.json().get("content", []))
    found = re.search(r"\{.*\}", text, re.DOTALL)
    try:
        parsed = json.loads(found.group(0)) if found else {}
    except ValueError:
        parsed = {}
    return {"bet": _money(parsed.get("bet")), "to_win": _money(parsed.get("to_win"))}

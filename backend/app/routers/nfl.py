import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.models.nfl_pick import NflPick
from app.services.http_client import client

router = APIRouter(prefix="/api/nfl", tags=["nfl"])

# Mirrors bets.py's WEEK_COUNT — the My Bets page only ever shows the same
# 1-15 week span as the rest of the site.
WEEK_COUNT = 15

ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"

log = logging.getLogger(__name__)


class PickUpdate(BaseModel):
    team_id: str | None = None


def _team_dict(competitor: dict) -> dict:
    team = competitor.get("team") or {}
    return {
        "id": team.get("abbreviation"),
        "name": team.get("shortDisplayName") or team.get("displayName") or team.get("abbreviation"),
        "logo": team.get("logo"),
    }


def _game_dict(event: dict) -> dict | None:
    competitions = event.get("competitions") or []
    if not competitions:
        return None
    competitors = competitions[0].get("competitors") or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), None)
    away = next((c for c in competitors if c.get("homeAway") == "away"), None)
    if not home or not away:
        return None

    return {
        "id": event.get("id"),
        "date": event.get("date"),
        "home": _team_dict(home),
        "away": _team_dict(away),
    }


async def _fetch_week_games(week: int, season_year: int) -> list[dict]:
    try:
        resp = await client.get(
            ESPN_SCOREBOARD_URL,
            params={"week": week, "seasontype": 2, "dates": season_year},
        )
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:  # network hiccup, upstream format change, etc.
        log.error("Failed to fetch NFL schedule for week %s (%s): %s", week, season_year, exc)
        raise HTTPException(status_code=502, detail="Could not reach the NFL schedule source") from exc

    games = [g for g in (_game_dict(e) for e in payload.get("events", [])) if g]
    games.sort(key=lambda g: g["date"] or "")
    return games


@router.get("/schedule/{week}")
async def get_week_schedule(week: int, season: int | None = None):
    """Real NFL head-to-head matchups for one week, proxied from ESPN's public scoreboard."""
    if not 1 <= week <= WEEK_COUNT:
        raise HTTPException(status_code=404, detail="Week out of range")
    season_year = season or date.today().year
    games = await _fetch_week_games(week, season_year)
    return {"week": week, "season": season_year, "games": games}


@router.get("/picks")
async def list_picks(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(NflPick))).scalars().all()
    picks: dict[str, dict[str, str]] = {}
    for row in rows:
        picks.setdefault(f"week{row.week}", {})[row.game_id] = row.team_id
    return {"picks": picks}


@router.put("/picks/{week}/{game_id}")
async def set_pick(week: int, game_id: str, body: PickUpdate, db: AsyncSession = Depends(get_db)):
    """Set (or, with team_id omitted, clear) the pick for one game."""
    row = await db.scalar(select(NflPick).where(NflPick.week == week, NflPick.game_id == game_id))

    if body.team_id is None:
        if row:
            await db.delete(row)
            await db.commit()
        return {"week": week, "game_id": game_id, "team_id": None}

    if not row:
        row = NflPick(week=week, game_id=game_id, team_id=body.team_id)
        db.add(row)
    else:
        row.team_id = body.team_id
    await db.commit()
    return {"week": week, "game_id": game_id, "team_id": row.team_id}

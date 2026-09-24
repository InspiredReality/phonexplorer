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

MARKETS = ("moneyline", "ats")

ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"

log = logging.getLogger(__name__)


class PickUpdate(BaseModel):
    team_id: str | None = None


def _extract_odds(competition: dict) -> dict:
    """Pull moneyline/spread numbers from ESPN's odds block, if present.

    ESPN only publishes odds once a book has posted a line (usually not far
    in advance), so every field here is nullable — the frontend shows
    whatever's available and still lets a pick be made without it.
    """
    odds_list = competition.get("odds") or []
    if not odds_list:
        return {"home_moneyline": None, "away_moneyline": None, "home_spread": None, "away_spread": None}

    odds = odds_list[0]
    home_ml = (odds.get("homeTeamOdds") or {}).get("moneyLine")
    away_ml = (odds.get("awayTeamOdds") or {}).get("moneyLine")
    # ESPN's top-level "spread" is the home team's line (negative = home favored).
    spread = odds.get("spread")
    home_spread = spread if isinstance(spread, (int, float)) else None
    away_spread = -spread if isinstance(spread, (int, float)) else None

    return {
        "home_moneyline": home_ml,
        "away_moneyline": away_ml,
        "home_spread": home_spread,
        "away_spread": away_spread,
    }


def _score(competitor: dict) -> int | None:
    raw = competitor.get("score")
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _team_dict(competitor: dict, moneyline: int | None, spread: float | None) -> dict:
    team = competitor.get("team") or {}
    return {
        "id": team.get("abbreviation"),
        "name": team.get("shortDisplayName") or team.get("displayName") or team.get("abbreviation"),
        "logo": team.get("logo"),
        "moneyline": moneyline,
        "spread": spread,
        "score": _score(competitor),
    }


def _game_dict(event: dict) -> dict | None:
    competitions = event.get("competitions") or []
    if not competitions:
        return None
    competition = competitions[0]
    competitors = competition.get("competitors") or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), None)
    away = next((c for c in competitors if c.get("homeAway") == "away"), None)
    if not home or not away:
        return None

    odds = _extract_odds(competition)
    completed = bool(((competition.get("status") or {}).get("type") or {}).get("completed"))

    return {
        "id": event.get("id"),
        "date": event.get("date"),
        "completed": completed,
        "home": _team_dict(home, odds["home_moneyline"], odds["home_spread"]),
        "away": _team_dict(away, odds["away_moneyline"], odds["away_spread"]),
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
    """Returns { picks: { week1: { <game_id>: { moneyline: <team_id>, ats: <team_id> } } } }."""
    rows = (await db.execute(select(NflPick))).scalars().all()
    picks: dict[str, dict[str, dict[str, str]]] = {}
    for row in rows:
        week_picks = picks.setdefault(f"week{row.week}", {})
        week_picks.setdefault(row.game_id, {})[row.market] = row.team_id
    return {"picks": picks}


@router.put("/picks/{week}/{game_id}/{market}")
async def set_pick(
    week: int, game_id: str, market: str, body: PickUpdate, db: AsyncSession = Depends(get_db)
):
    """Set (or, with team_id omitted, clear) the pick for one game's moneyline or ATS market."""
    if market not in MARKETS:
        raise HTTPException(status_code=404, detail="Unknown market")

    row = await db.scalar(
        select(NflPick).where(NflPick.week == week, NflPick.game_id == game_id, NflPick.market == market)
    )

    if body.team_id is None:
        if row:
            await db.delete(row)
            await db.commit()
        return {"week": week, "game_id": game_id, "market": market, "team_id": None}

    if not row:
        row = NflPick(week=week, game_id=game_id, market=market, team_id=body.team_id)
        db.add(row)
    else:
        row.team_id = body.team_id
    await db.commit()
    return {"week": week, "game_id": game_id, "market": market, "team_id": row.team_id}

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.models.nfl_game_cache import NflGameCache
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


def _row_to_game(row: NflGameCache) -> dict:
    return {
        "id": row.game_id,
        "date": row.date,
        "completed": row.completed,
        "home": {
            "id": row.home_id,
            "name": row.home_name,
            "logo": row.home_logo,
            "moneyline": row.home_moneyline,
            "spread": row.home_spread,
            "score": row.home_score,
        },
        "away": {
            "id": row.away_id,
            "name": row.away_name,
            "logo": row.away_logo,
            "moneyline": row.away_moneyline,
            "spread": row.away_spread,
            "score": row.away_score,
        },
    }


async def _load_cached_week(db: AsyncSession, week: int, season_year: int) -> list[dict] | None:
    """The cached games for this week/season, or None if nothing's cached yet."""
    rows = (
        await db.execute(
            select(NflGameCache).where(NflGameCache.week == week, NflGameCache.season == season_year)
        )
    ).scalars().all()
    if not rows:
        return None
    games = [_row_to_game(r) for r in rows]
    games.sort(key=lambda g: g["date"] or "")
    return games


def _merge_cached_fields(games: list[dict], cached_games: list[dict]) -> None:
    """Fill any null field in a freshly-fetched game from what was cached
    for it before — this is what keeps a spread available once ESPN stops
    returning odds for a game that's no longer upcoming."""
    cached_by_id = {g["id"]: g for g in cached_games}
    for g in games:
        cached = cached_by_id.get(g["id"])
        if not cached:
            continue
        for side in ("home", "away"):
            live_team, cached_team = g[side], cached[side]
            for field in ("id", "name", "logo", "score", "moneyline", "spread"):
                if live_team.get(field) is None and cached_team.get(field) is not None:
                    live_team[field] = cached_team[field]


async def _save_week_cache(db: AsyncSession, week: int, season_year: int, games: list[dict]) -> None:
    """Upsert this call's games into the cache. Only overwrites a field when
    the new value is non-null, so a score/odds ESPN no longer returns (e.g.
    the spread on a since-completed game) doesn't get clobbered with None."""
    game_ids = [g["id"] for g in games]
    if not game_ids:
        return
    existing = {
        row.game_id: row
        for row in (
            await db.execute(select(NflGameCache).where(NflGameCache.game_id.in_(game_ids)))
        ).scalars().all()
    }
    for g in games:
        row = existing.get(g["id"])
        if not row:
            row = NflGameCache(game_id=g["id"], week=week, season=season_year)
            db.add(row)
        row.week = week
        row.season = season_year
        row.date = g["date"]
        row.completed = g["completed"]
        for side in ("home", "away"):
            team = g[side]
            if team["id"] is not None:
                setattr(row, f"{side}_id", team["id"])
            if team["name"] is not None:
                setattr(row, f"{side}_name", team["name"])
            if team["logo"] is not None:
                setattr(row, f"{side}_logo", team["logo"])
            if team["score"] is not None:
                setattr(row, f"{side}_score", team["score"])
            if team["moneyline"] is not None:
                setattr(row, f"{side}_moneyline", team["moneyline"])
            if team["spread"] is not None:
                setattr(row, f"{side}_spread", team["spread"])
    await db.commit()


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
async def get_week_schedule(week: int, season: int | None = None, db: AsyncSession = Depends(get_db)):
    """Real NFL head-to-head matchups for one week.

    Cache-first: once every game in a week is completed, that week is
    permanent, so it's served straight from nfl_game_cache with no ESPN
    call at all — reopening the same week over and over costs nothing. A
    week still in progress (or never seen before) always goes live, so
    scores keep updating until it settles; whatever comes back is upserted
    into the cache (never overwriting a field with a null one), which is
    also what keeps a game's spread available for ATS grading after ESPN
    stops returning odds for a game that's no longer upcoming.

    If ESPN can't be reached and there's nothing better, a stale cached
    copy is served rather than failing outright.
    """
    if not 1 <= week <= WEEK_COUNT:
        raise HTTPException(status_code=404, detail="Week out of range")
    season_year = season or date.today().year

    cached_games = await _load_cached_week(db, week, season_year)
    if cached_games and all(g["completed"] for g in cached_games):
        return {"week": week, "season": season_year, "games": cached_games}

    try:
        games = await _fetch_week_games(week, season_year)
    except HTTPException:
        if cached_games:
            log.warning("ESPN unreachable for week %s (%s); serving stale cache", week, season_year)
            return {"week": week, "season": season_year, "games": cached_games}
        raise

    if cached_games:
        _merge_cached_fields(games, cached_games)

    await _save_week_cache(db, week, season_year, games)
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

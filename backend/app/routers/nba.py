import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import get_db
from app.models.nba import (
    NbaBoxLine, NbaFormulaVersion, NbaGame, NbaPlayer, NbaPlayerAlias, NbaPrediction,
)
from app.services import nba_ingest, nba_model as m
from app.services.http_client import client

router = APIRouter(prefix="/api/nba", tags=["nba"])
log = logging.getLogger(__name__)

Pos = Literal["G", "F", "C"]
_ingest_lock = asyncio.Lock()


def _require_admin(authorization: str | None = Header(default=None)):
    if not settings.admin_token or authorization != f"Bearer {settings.admin_token}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Loading helpers ────────────────────────────────────────────────────────────

class Data:
    """Final games + lines + fixed positions, loaded once per request."""

    def __init__(self, games: list[NbaGame], lines: list[NbaBoxLine], players: list[NbaPlayer]):
        self.games = {g.id: g for g in games}
        self.lines = lines
        self.player_pos = {(p.team, p.player): p.pos for p in players}
        self.lines_by_game: dict[str, list[m.Line]] = {}
        for ln in lines:
            self.lines_by_game.setdefault(ln.game_id, []).append(
                m.Line(ln.game_id, ln.team, ln.player, ln.points, ln.started)
            )

    def pos_of(self, team: str, player: str) -> str | None:
        return self.player_pos.get((team, player))

    def model_games(self) -> list[m.Game]:
        return sorted(
            (m.Game(g.id, g.date, g.home_team, g.away_team) for g in self.games.values()),
            key=lambda g: (g.date, g.id),
        )

    def stats_before(self, before_date: str | None = None, through_date: str | None = None) -> m.Stats:
        """Stats from final games dated < before_date (or <= through_date)."""
        st = m.Stats(self.pos_of)
        for g in self.model_games():
            if before_date is not None and g.date >= before_date:
                continue
            if through_date is not None and g.date > through_date:
                continue
            st.add_game(g, self.lines_by_game.get(g.id, []))
        return st


async def _load_final(db: AsyncSession) -> Data:
    games = (await db.execute(select(NbaGame).where(NbaGame.status == "final"))).scalars().all()
    ids = [g.id for g in games]
    lines = (await db.execute(select(NbaBoxLine).where(NbaBoxLine.game_id.in_(ids)))).scalars().all() if ids else []
    players = (await db.execute(select(NbaPlayer))).scalars().all()
    return Data(list(games), list(lines), list(players))


def _iso(d: str | None, name: str) -> str | None:
    if d is None:
        return None
    try:
        return date.fromisoformat(d).isoformat()
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{name} must be YYYY-MM-DD")


def _iso_ts(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _game_dict(g: NbaGame) -> dict:
    return {
        "id": g.id, "date": g.date, "home": g.home_team, "away": g.away_team,
        "home_score": g.home_score, "away_score": g.away_score, "status": g.status,
    }


# ── Games / teams ──────────────────────────────────────────────────────────────

@router.get("/games")
async def list_games(
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(NbaGame).order_by(NbaGame.date, NbaGame.id)
    if (f := _iso(from_, "from")):
        q = q.where(NbaGame.date >= f)
    if (t := _iso(to, "to")):
        q = q.where(NbaGame.date <= t)
    if status:
        q = q.where(NbaGame.status == status)
    return [_game_dict(g) for g in (await db.execute(q)).scalars().all()]


@router.get("/games/{game_id}/box")
async def game_box(game_id: str, db: AsyncSession = Depends(get_db)):
    if await db.get(NbaGame, game_id) is None:
        raise HTTPException(status_code=404, detail="Game not found")
    lines = (await db.execute(
        select(NbaBoxLine).where(NbaBoxLine.game_id == game_id).order_by(NbaBoxLine.team, NbaBoxLine.id)
    )).scalars().all()
    pos = {(p.team, p.player): p.pos for p in (await db.execute(select(NbaPlayer))).scalars().all()}
    return [
        {"team": l.team, "player": l.player, "pos": pos.get((l.team, l.player)),
         "points": l.points, "started": l.started, "listed_pos": l.listed_pos}
        for l in lines
    ]


@router.get("/teams/allowed")
async def teams_allowed(asof: str | None = None, db: AsyncSession = Depends(get_db)):
    """Points allowed by position. `asof` is inclusive (games dated <= asof)."""
    data = await _load_final(db)
    return m.team_table(data.stats_before(through_date=_iso(asof, "asof")))


# ── Players ────────────────────────────────────────────────────────────────────

async def _player_dict(db: AsyncSession, p: NbaPlayer) -> dict:
    aliases = (await db.execute(
        select(NbaPlayerAlias.alias).where(NbaPlayerAlias.team == p.team, NbaPlayerAlias.player == p.player)
    )).scalars().all()
    return {"team": p.team, "player": p.player, "pos": p.pos, "aliases": sorted(aliases)}


@router.get("/players")
async def list_players(team: str | None = None, unassigned: bool = False, db: AsyncSession = Depends(get_db)):
    q = select(NbaPlayer).order_by(NbaPlayer.team, NbaPlayer.player)
    if team:
        q = q.where(NbaPlayer.team == _team(team))
    if unassigned:
        q = q.where(NbaPlayer.pos.is_(None))
    players = (await db.execute(q)).scalars().all()
    alias_rows = (await db.execute(select(NbaPlayerAlias))).scalars().all()
    by_player: dict[tuple[str, str], list[str]] = {}
    for a in alias_rows:
        by_player.setdefault((a.team, a.player), []).append(a.alias)
    return [
        {"team": p.team, "player": p.player, "pos": p.pos, "aliases": sorted(by_player.get((p.team, p.player), []))}
        for p in players
    ]


class PlayerUpdate(BaseModel):
    pos: Pos


@router.put("/players/{team}/{player}")
async def set_player_pos(
    team: str, player: str, body: PlayerUpdate,
    db: AsyncSession = Depends(get_db), _: None = Depends(_require_admin),
):
    team = _team(team)
    p = await db.get(NbaPlayer, (team, player))
    if p is None:
        raise HTTPException(status_code=404, detail="Player not found")
    p.pos = body.pos
    await db.commit()
    return await _player_dict(db, p)


def _team(raw: str) -> str:
    try:
        return m.normalize_team(raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


# ── Formulas ───────────────────────────────────────────────────────────────────

def _formula_dict(f: NbaFormulaVersion, locked: bool | None = None) -> dict:
    return {
        "id": f.id, "name": f.name, "description": f.description, "params": f.params,
        "locked": f.locked if locked is None else locked, "created_at": _iso_ts(f.created_at),
    }


@router.get("/formulas")
async def list_formulas(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(NbaFormulaVersion).order_by(NbaFormulaVersion.created_at, NbaFormulaVersion.id))).scalars().all()
    # Locked once any of its predictions has been graded (its game is final).
    graded = set((await db.execute(
        select(NbaPrediction.formula_id).join(NbaGame, NbaGame.id == NbaPrediction.game_id)
        .where(NbaGame.status == "final").distinct()
    )).scalars().all())
    return [_formula_dict(f, f.locked or f.id in graded) for f in rows]


class FormulaCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    params: dict = Field(default_factory=dict)
    copy_from: str | None = None


@router.post("/formulas")
async def create_formula(body: FormulaCreate, db: AsyncSession = Depends(get_db), _: None = Depends(_require_admin)):
    params: dict = {}
    description = body.description
    if body.copy_from:
        src = await db.get(NbaFormulaVersion, body.copy_from)
        if src is None:
            raise HTTPException(status_code=404, detail=f"copy_from formula {body.copy_from!r} not found")
        params = dict(src.params)
        description = description or src.description
    params.update(body.params)
    problems = m.validate_params(params)
    if problems:
        raise HTTPException(status_code=422, detail="; ".join(problems))
    fid = m.slugify(body.name)
    if not fid:
        raise HTTPException(status_code=422, detail="name must contain letters or digits")
    clash = (await db.execute(select(NbaFormulaVersion).where(
        (NbaFormulaVersion.id == fid) | (NbaFormulaVersion.name == body.name)
    ))).scalars().first()
    if clash:
        raise HTTPException(status_code=409, detail=f"A formula named {clash.name!r} already exists; versions are immutable, pick a new name")
    f = NbaFormulaVersion(id=fid, name=body.name, description=description, params=params, locked=False)
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _formula_dict(f)


async def _formulas_by_id(db: AsyncSession, ids: list[str]) -> dict[str, NbaFormulaVersion]:
    rows = {f.id: f for f in (await db.execute(
        select(NbaFormulaVersion).where(NbaFormulaVersion.id.in_(ids))
    )).scalars().all()} if ids else {}
    missing = [i for i in ids if i not in rows]
    if missing:
        raise HTTPException(status_code=404, detail=f"Unknown formula id(s): {', '.join(missing)}")
    return rows


# ── Lineups / predictions ──────────────────────────────────────────────────────

@router.get("/games/{game_id}/lineup-candidates")
async def lineup_candidates(game_id: str, db: AsyncSession = Depends(get_db)):
    game = await db.get(NbaGame, game_id)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    data = await _load_final(db)
    st = data.stats_before(before_date=game.date)
    prior = [g for g in data.model_games() if g.date < game.date]
    out = []
    for team in (game.away_team, game.home_team):
        recent = [g.id for g in prior if team in (g.home, g.away)][-5:]
        starts: dict[str, int] = {}
        for gid in recent:
            for ln in data.lines_by_game.get(gid, []):
                if ln.team == team and ln.started:
                    starts[ln.player] = starts.get(ln.player, 0) + 1
        cands = []
        for (t, player), log_ in st.players.items():
            if t != team or not log_.gp:
                continue
            cands.append({
                "team": team, "player": player, "pos": data.pos_of(team, player),
                "season_avg": log_.total / log_.gp, "gp": log_.gp,
                "_starts": starts.get(player, 0),
            })
        cands.sort(key=lambda c: (-c["_starts"], -c["gp"], -c["season_avg"], c["player"]))
        for i, c in enumerate(cands):
            c["default_starter"] = i < 5 and c["_starts"] > 0
            del c["_starts"]
        out.extend(cands)
    return out


class PredictPlayer(BaseModel):
    team: str
    player: str
    is_starter: bool = True  # additive: UBettors lists the lineup it wants, starters by default


class PredictBody(BaseModel):
    game_id: str
    formula_ids: list[str] = Field(min_length=1)
    players: list[PredictPlayer] = Field(min_length=1)


def _tipped(game: NbaGame, now: datetime) -> bool:
    if game.status == "final":
        return True
    if game.tip_time is not None:
        tip = game.tip_time if game.tip_time.tzinfo else game.tip_time.replace(tzinfo=timezone.utc)
        return now >= tip
    # No tip time known: treat any past calendar day (US Eastern) as already started.
    return game.date < now.astimezone(nba_ingest.EASTERN).date().isoformat()


async def _prediction_dicts(db: AsyncSession, preds: list[NbaPrediction]) -> list[dict]:
    if not preds:
        return []
    games = {g.id: g for g in (await db.execute(
        select(NbaGame).where(NbaGame.id.in_({p.game_id for p in preds}))
    )).scalars().all()}
    lines = {(l.game_id, l.team, l.player): l.points for l in (await db.execute(
        select(NbaBoxLine).where(NbaBoxLine.game_id.in_(list(games)))
    )).scalars().all()}
    out = []
    for p in preds:
        g = games[p.game_id]
        actual = lines.get((p.game_id, p.team, p.player)) if g.status == "final" else None
        out.append({
            "id": p.id, "game_id": p.game_id, "game_date": g.date, "team": p.team,
            "opp": g.away_team if p.team == g.home_team else g.home_team,
            "player": p.player, "pos": p.pos, "formula_id": p.formula_id,
            "player_avg": p.player_avg, "adj": p.adj, "predicted": p.predicted,
            "actual": actual, "error": None if actual is None else p.predicted - actual,
            "is_starter": p.is_starter, "locked": p.locked or g.status == "final",
            "created_at": _iso_ts(p.created_at),
        })
    return out


@router.post("/predict")
async def predict(body: PredictBody, db: AsyncSession = Depends(get_db), _: None = Depends(_require_admin)):
    game = await db.get(NbaGame, body.game_id)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    if _tipped(game, datetime.now(timezone.utc)):
        raise HTTPException(status_code=409, detail="Game has already started or finished; predictions are closed")
    formulas = await _formulas_by_id(db, body.formula_ids)
    for f in formulas.values():
        if m.validate_params(f.params):
            raise HTTPException(status_code=422, detail=f"Formula {f.id!r} has invalid params")

    data = await _load_final(db)
    st = data.stats_before(before_date=game.date)
    mg = m.Game(game.id, game.date, game.home_team, game.away_team)

    problems, planned = [], []
    for pl in body.players:
        team = _team(pl.team)
        if team not in (game.home_team, game.away_team):
            problems.append(f"{team} {pl.player}: team is not playing in {game.id}")
            continue
        for fid in body.formula_ids:
            pr = m.project(st, mg, team, pl.player, formulas[fid].params)
            if pr is None:
                reason = "no position assigned" if data.pos_of(team, pl.player) is None else "no games played yet"
                problems.append(f"{team} {pl.player}: {reason}")
                break
            planned.append((team, pl, fid, pr))
    if problems:
        raise HTTPException(status_code=422, detail="Cannot predict: " + "; ".join(sorted(set(problems))))

    saved = []
    for team, pl, fid, pr in planned:
        row = (await db.execute(select(NbaPrediction).where(
            NbaPrediction.game_id == game.id, NbaPrediction.formula_id == fid,
            NbaPrediction.team == team, NbaPrediction.player == pl.player,
        ))).scalar_one_or_none()
        if row is not None and row.locked:
            raise HTTPException(status_code=409, detail=f"Prediction for {pl.player} ({fid}) is locked")
        if row is None:
            row = NbaPrediction(game_id=game.id, formula_id=fid, team=team, player=pl.player)
            db.add(row)
        row.pos = data.pos_of(team, pl.player)
        row.player_avg, row.adj, row.predicted = pr.player_avg, pr.adj, pr.predicted
        row.is_starter = pl.is_starter
        row.created_at = datetime.now(timezone.utc)
        saved.append(row)
    await db.commit()
    for r in saved:
        await db.refresh(r)
    return await _prediction_dicts(db, saved)


@router.get("/predictions")
async def list_predictions(
    game_id: str | None = None, formula_id: str | None = None,
    from_: str | None = Query(default=None, alias="from"), to: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(NbaPrediction).join(NbaGame, NbaGame.id == NbaPrediction.game_id)
    if game_id:
        q = q.where(NbaPrediction.game_id == game_id)
    if formula_id:
        q = q.where(NbaPrediction.formula_id == formula_id)
    if (f := _iso(from_, "from")):
        q = q.where(NbaGame.date >= f)
    if (t := _iso(to, "to")):
        q = q.where(NbaGame.date <= t)
    q = q.order_by(NbaGame.date, NbaPrediction.id)
    return await _prediction_dicts(db, list((await db.execute(q)).scalars().all()))


# ── Accuracy / backtest ────────────────────────────────────────────────────────

def _group_key(group_by: str, *, pos: str, team: str, date_: str) -> str:
    return {"none": "all", "pos": pos, "team": team, "week": m.week_key(date_)}[group_by]


@router.get("/accuracy")
async def accuracy(
    formula_ids: str | None = None,
    from_: str | None = Query(default=None, alias="from"), to: str | None = None,
    group_by: Literal["none", "pos", "team", "week"] = "none",
    db: AsyncSession = Depends(get_db),
):
    """Graded accuracy of stored predictions. Players who did not play are excluded
    from the metrics and counted in `dnp`."""
    q = select(NbaPrediction, NbaGame).join(NbaGame, NbaGame.id == NbaPrediction.game_id).where(NbaGame.status == "final")
    ids = [i for i in (formula_ids or "").split(",") if i]
    if ids:
        q = q.where(NbaPrediction.formula_id.in_(ids))
    if (f := _iso(from_, "from")):
        q = q.where(NbaGame.date >= f)
    if (t := _iso(to, "to")):
        q = q.where(NbaGame.date <= t)
    rows = (await db.execute(q)).all()
    gids = {g.id for _, g in rows}
    actual = {(l.game_id, l.team, l.player): l.points for l in (await db.execute(
        select(NbaBoxLine).where(NbaBoxLine.game_id.in_(gids))
    )).scalars().all()} if gids else {}

    pairs: dict[tuple[str, str], list[tuple[float, float]]] = {}
    dnp: dict[tuple[str, str], int] = {}
    base_pairs: dict[str, list[tuple[float, float]]] = {}
    base_dnp: dict[str, int] = {}
    base_seen: set[tuple] = set()
    for p, g in rows:
        grp = _group_key(group_by, pos=p.pos, team=p.team, date_=g.date)
        act = actual.get((p.game_id, p.team, p.player))
        key = (p.formula_id, grp)
        if act is None:
            dnp[key] = dnp.get(key, 0) + 1
        else:
            pairs.setdefault(key, []).append((p.predicted, act))
        bk = (p.game_id, p.team, p.player)  # baseline counted once per player-game
        if bk not in base_seen:
            base_seen.add(bk)
            if act is None:
                base_dnp[grp] = base_dnp.get(grp, 0) + 1
            else:
                base_pairs.setdefault(grp, []).append((p.player_avg, act))

    out = [
        {"formula_id": fid, "group": grp, "metrics": m.metrics(pr), "dnp": dnp.get((fid, grp), 0)}
        for (fid, grp), pr in sorted(pairs.items())
    ]
    out += [
        {"formula_id": "baseline_avg", "group": grp, "metrics": m.metrics(pr), "dnp": base_dnp.get(grp, 0)}
        for grp, pr in sorted(base_pairs.items())
    ]
    return out


class BacktestBody(BaseModel):
    formula_ids: list[str] = Field(min_length=1)
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    min_team_gp: int = Field(default=5, ge=0)
    group_by: Literal["none", "pos", "team", "week"] = "none"  # additive

    model_config = {"populate_by_name": True}


@router.post("/backtest")
async def run_backtest(body: BacktestBody, db: AsyncSession = Depends(get_db), _: None = Depends(_require_admin)):
    """Read-only: replays final games in date order using prior games only."""
    formulas = await _formulas_by_id(db, body.formula_ids)
    for f in formulas.values():
        if m.validate_params(f.params):
            raise HTTPException(status_code=422, detail=f"Formula {f.id!r} has invalid params")
    lo, hi = _iso(body.from_, "from"), _iso(body.to, "to")
    data = await _load_final(db)
    # Stats must start from the beginning of the season, so replay everything and
    # only report rows inside [from, to].
    rows, warnings = m.backtest(
        data.model_games(), data.lines_by_game, data.pos_of,
        {fid: f.params for fid, f in formulas.items()}, body.min_team_gp,
    )
    in_range = [
        r for r in rows if (lo is None or r.date >= lo) and (hi is None or r.date <= hi)
    ]
    n_games = len({r.game_id for r in in_range})
    if not in_range:
        warnings.append("No graded starter rows in the requested range.")
    grouped: dict[tuple[str, str], list[tuple[float, float]]] = {}
    base: list[tuple[float, float]] = []
    for r in in_range:
        grp = _group_key(body.group_by, pos=r.pos, team=r.team, date_=r.date)
        base.append((r.baseline, r.actual))
        for fid, pred in r.predicted.items():
            grouped.setdefault((fid, grp), []).append((pred, r.actual))
    return {
        "results": [
            {"formula_id": fid, "group": grp, "metrics": m.metrics(pr)}
            for (fid, grp), pr in sorted(grouped.items())
        ],
        "baseline": m.metrics(base),
        "n_games": n_games,
        "warnings": warnings,
    }


# ── Ingestion ──────────────────────────────────────────────────────────────────

class IngestBody(BaseModel):
    date: str | None = None


async def run_ingest(db: AsyncSession, day: str | None) -> dict:
    """Ingest one date, or yesterday + today (US Eastern) when none is given."""
    if day:
        days = [date.fromisoformat(_iso(day, "date"))]
    else:
        today = datetime.now(nba_ingest.EASTERN).date()
        days = [today - timedelta(days=1), today]
    report = {"games_added": 0, "mismatches": [], "unknown_players": []}
    async with _ingest_lock:
        for d in days:
            await nba_ingest.ingest_date(db, client, d, report)
    return report


@router.post("/ingest/run")
async def ingest_run(body: IngestBody | None = None, db: AsyncSession = Depends(get_db), _: None = Depends(_require_admin)):
    try:
        return await run_ingest(db, body.date if body else None)
    except nba_ingest.IngestBlocked as exc:
        raise HTTPException(status_code=502, detail=f"Source blocked the request: {exc}")
    except nba_ingest.IngestError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

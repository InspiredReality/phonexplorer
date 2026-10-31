"""
NBA points model — pure computation, no database or network.

Everything here works on plain dataclasses so the same code serves live
predictions, accuracy grading and backtests, and so tests can run without a
database. Callers load rows, build `Game` / `Line` objects, and feed them in
date order.

No-leakage rule: `Stats` only ever contains games added to it. Callers add a
game *after* predicting for it (backtest) or only add games dated before the
prediction date (live), so a prediction never sees its own game or later ones.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Iterable

POSITIONS = ("G", "F", "C")

_POS_MAP = {
    "G": "G", "PG": "G", "SG": "G", "GUARD": "G",
    "F": "F", "SF": "F", "PF": "F", "FORWARD": "F",
    "C": "C", "CENTER": "C",
}


def map_pos(label: str | None) -> str | None:
    """Raw position label -> G/F/C, or None if unrecognised (never guessed).

    Combo labels like "G-F" or "SF/PF" are ambiguous, so they map to None.
    """
    if not label:
        return None
    return _POS_MAP.get(label.strip().upper())


# ── Teams ──────────────────────────────────────────────────────────────────────

TEAM_NAMES = {
    "ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BKN": "Brooklyn Nets",
    "CHA": "Charlotte Hornets", "CHI": "Chicago Bulls", "CLE": "Cleveland Cavaliers",
    "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets", "DET": "Detroit Pistons",
    "GSW": "Golden State Warriors", "HOU": "Houston Rockets", "IND": "Indiana Pacers",
    "LAC": "Los Angeles Clippers", "LAL": "Los Angeles Lakers", "MEM": "Memphis Grizzlies",
    "MIA": "Miami Heat", "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves",
    "NOP": "New Orleans Pelicans", "NYK": "New York Knicks", "OKC": "Oklahoma City Thunder",
    "ORL": "Orlando Magic", "PHI": "Philadelphia 76ers", "PHX": "Phoenix Suns",
    "POR": "Portland Trail Blazers", "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs",
    "TOR": "Toronto Raptors", "UTA": "Utah Jazz", "WAS": "Washington Wizards",
}
_TEAM_ALIASES = {"BRK": "BKN", "CHO": "CHA", "GS": "GSW", "NO": "NOP", "NY": "NYK",
                 "PHO": "PHX", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}
_NAME_TO_CODE = {}
for _code, _name in TEAM_NAMES.items():
    _NAME_TO_CODE[_name.lower()] = _code
    _NAME_TO_CODE[_name.split()[-1].lower()] = _code  # "celtics", "76ers", "blazers"
_NAME_TO_CODE["trail blazers"] = "POR"


def normalize_team(raw: str) -> str:
    """Team code ("BOS"), city+nickname ("Boston Celtics") or nickname -> 3-letter code."""
    s = (raw or "").strip()
    up = s.upper()
    if up in TEAM_NAMES:
        return up
    if up in _TEAM_ALIASES:
        return _TEAM_ALIASES[up]
    code = _NAME_TO_CODE.get(s.lower())
    if code:
        return code
    raise ValueError(f"Unrecognised team: {raw!r}")


# ── Data shapes ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Game:
    id: str
    date: str  # ISO YYYY-MM-DD
    home: str
    away: str


@dataclass(frozen=True)
class Line:
    game_id: str
    team: str
    player: str
    points: int
    started: bool = False


def _zero() -> dict[str, float]:
    return {p: 0.0 for p in POSITIONS}


@dataclass
class _PlayerLog:
    total: float = 0.0
    gp: int = 0
    games: list[tuple[str, int, bool]] = field(default_factory=list)  # (date, points, was_home)


class Stats:
    """Running season totals built from games added so far."""

    def __init__(self, pos_of: Callable[[str, str], str | None]):
        # pos_of(team, player) -> "G"/"F"/"C" or None (unassigned)
        self.pos_of = pos_of
        self.gp: dict[str, int] = defaultdict(int)
        self.allowed: dict[str, dict[str, float]] = defaultdict(_zero)
        self.players: dict[tuple[str, str], _PlayerLog] = defaultdict(_PlayerLog)
        self.last_game_date: dict[str, str] = {}

    def add_game(self, game: Game, lines: Iterable[Line]) -> None:
        for ln in lines:
            opp = game.away if ln.team == game.home else game.home
            pos = self.pos_of(ln.team, ln.player)
            if pos is not None:  # unassigned players stay out of the position tables
                self.allowed[opp][pos] += ln.points
            log = self.players[(ln.team, ln.player)]
            log.total += ln.points
            log.gp += 1
            log.games.append((game.date, ln.points, ln.team == game.home))
        for t in (game.home, game.away):
            self.gp[t] += 1
            self.last_game_date[t] = game.date

    # allowed per game by position for one team
    def allowed_pg(self, team: str) -> dict[str, float]:
        gp = self.gp.get(team, 0)
        if not gp:
            return _zero()
        a = self.allowed[team] if team in self.allowed else _zero()
        return {p: a[p] / gp for p in POSITIONS}

    def league_avg(self) -> dict[str, float]:
        """Mean of per-game allowed across every team that has played (30 in-season)."""
        teams = [t for t, g in self.gp.items() if g > 0]
        if not teams:
            return _zero()
        return {p: sum(self.allowed_pg(t)[p] for t in teams) / len(teams) for p in POSITIONS}

    def player_avg(self, team: str, player: str) -> tuple[float | None, int]:
        log = self.players.get((team, player))
        if not log or not log.gp:
            return None, 0
        return log.total / log.gp, log.gp


def team_table(stats: Stats) -> dict:
    """Shape for GET /teams/allowed."""
    league = stats.league_avg()
    teams = []
    for t in sorted(t for t, g in stats.gp.items() if g > 0):
        pg = stats.allowed_pg(t)
        total = stats.allowed[t] if t in stats.allowed else _zero()
        teams.append({
            "team": t,
            "gp": stats.gp[t],
            "allowed_total": {p: total[p] for p in POSITIONS},
            "allowed_pg": pg,
            "vs_league": {p: pg[p] - league[p] for p in POSITIONS},
        })
    return {"league_avg": league, "teams": teams}


# ── Variable registry ──────────────────────────────────────────────────────────
#
# A formula is `sum(weight[v] * value[v])` over its enabled variables. To add a
# variable: write one function `fn(ctx) -> float | None` below, register it with
# the name of the params key holding its weight, then list it in a formula's
# `variables` and set its weight. The engine itself never changes.

@dataclass
class Ctx:
    stats: Stats
    game: Game
    team: str
    opp: str
    player: str
    pos: str
    player_avg: float
    gp: int
    params: dict

    @property
    def is_home(self) -> bool:
        return self.team == self.game.home

    @property
    def adj(self) -> float:
        return self.stats.allowed_pg(self.opp)[self.pos] - self.stats.league_avg()[self.pos]


def _v_player_avg(ctx: Ctx) -> float:
    return ctx.player_avg


def _v_pos_defense_adj(ctx: Ctx) -> float:
    return ctx.adj


def _v_last_n_form(ctx: Ctx) -> float | None:
    """Mean of the last N games minus the season average (default N=5)."""
    n = int(ctx.params.get("last_n", 5))
    games = ctx.stats.players[(ctx.team, ctx.player)].games[-n:]
    if not games:
        return None
    return sum(p for _, p, _ in games) / len(games) - ctx.player_avg


def _v_home_away(ctx: Ctx) -> float | None:
    """Player's average at this venue (home/away) minus season average."""
    same = [p for _, p, h in ctx.stats.players[(ctx.team, ctx.player)].games if h == ctx.is_home]
    if not same:
        return None
    return sum(same) / len(same) - ctx.player_avg


@dataclass(frozen=True)
class Variable:
    fn: Callable[[Ctx], float | None]
    weight_key: str  # params key holding this variable's weight
    default_weight: float = 0.0


VARIABLES: dict[str, Variable] = {
    "player_avg": Variable(_v_player_avg, "w_avg", 1.0),
    "pos_defense_adj": Variable(_v_pos_defense_adj, "w_adj", 0.25),
    "last_n_form": Variable(_v_last_n_form, "w_form"),
    "home_away": Variable(_v_home_away, "w_home_away"),
}
# Ideas not implemented yet (need minutes / schedule / score data we do not
# ingest): minutes, pace, back_to_back, blowout_filter.


def validate_params(params: dict) -> list[str]:
    """Return a list of problems with a formula's params (empty = valid)."""
    problems = []
    variables = params.get("variables")
    if not isinstance(variables, list) or not variables:
        problems.append("params.variables must be a non-empty list")
        return problems
    for v in variables:
        if v not in VARIABLES:
            problems.append(f"unknown variable {v!r}; available: {sorted(VARIABLES)}")
            continue
        key = VARIABLES[v].weight_key
        w = params.get(key, VARIABLES[v].default_weight)
        if not isinstance(w, (int, float)) or isinstance(w, bool) or not math.isfinite(w):
            problems.append(f"params.{key} must be a finite number")
    for key in ("w_avg", "w_adj"):
        if key in params and not isinstance(params[key], (int, float)):
            problems.append(f"params.{key} must be a number")
    return problems


# ── Prediction ─────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Projection:
    player_avg: float
    adj: float
    predicted: float
    gp: int


def project(stats: Stats, game: Game, team: str, player: str, params: dict) -> Projection | None:
    """Predict one player's points. None if unassigned or no games played yet."""
    pos = stats.pos_of(team, player)
    avg, gp = stats.player_avg(team, player)
    if pos is None or avg is None:
        return None
    opp = game.away if team == game.home else game.home
    ctx = Ctx(stats, game, team, opp, player, pos, avg, gp, params)
    total = 0.0
    for name in params["variables"]:
        var = VARIABLES[name]
        value = var.fn(ctx)
        if value is None:
            continue  # variable has no data for this player yet; contributes nothing
        total += params.get(var.weight_key, var.default_weight) * value
    return Projection(player_avg=avg, adj=ctx.adj, predicted=total, gp=gp)


# ── Metrics ────────────────────────────────────────────────────────────────────

def metrics(pairs: Iterable[tuple[float, float]]) -> dict:
    """pairs of (predicted, actual). error = predicted - actual."""
    errs = [p - a for p, a in pairs]
    n = len(errs)
    if n == 0:
        return {"n": 0, "mae": None, "rmse": None, "bias": None, "within3": None, "within5": None}
    return {
        "n": n,
        "mae": sum(abs(e) for e in errs) / n,
        "rmse": math.sqrt(sum(e * e for e in errs) / n),
        "bias": sum(errs) / n,
        "within3": sum(1 for e in errs if abs(e) <= 3) / n,
        "within5": sum(1 for e in errs if abs(e) <= 5) / n,
    }


# ── Backtest ───────────────────────────────────────────────────────────────────

@dataclass
class BacktestRow:
    game_id: str
    date: str
    team: str
    opp: str
    player: str
    pos: str
    actual: int
    baseline: float
    predicted: dict[str, float]  # formula_id -> predicted


def backtest(
    games: list[Game],
    lines_by_game: dict[str, list[Line]],
    pos_of: Callable[[str, str], str | None],
    formulas: dict[str, dict],  # formula_id -> params
    min_team_gp: int = 5,
) -> tuple[list[BacktestRow], list[str]]:
    """Walk games in date order; predict starters from prior games only.

    All games on the same date are predicted before any of them is added, so
    a game never sees another game played that same day.
    """
    stats = Stats(pos_of)
    rows: list[BacktestRow] = []
    warnings: list[str] = []
    low_gp_games = 0
    by_date: dict[str, list[Game]] = defaultdict(list)
    for g in games:
        by_date[g.date].append(g)

    for d in sorted(by_date):
        for g in by_date[d]:
            lines = lines_by_game.get(g.id, [])
            if min(stats.gp[g.home], stats.gp[g.away]) < min_team_gp:
                low_gp_games += 1
            for ln in lines:
                if not ln.started:
                    continue
                pos = pos_of(ln.team, ln.player)
                avg, _ = stats.player_avg(ln.team, ln.player)
                if pos is None or avg is None:
                    continue
                preds = {
                    fid: project(stats, g, ln.team, ln.player, params).predicted
                    for fid, params in formulas.items()
                }
                rows.append(BacktestRow(
                    g.id, g.date, ln.team, g.away if ln.team == g.home else g.home,
                    ln.player, pos, ln.points, avg, preds,
                ))
        for g in by_date[d]:
            stats.add_game(g, lines_by_game.get(g.id, []))

    if low_gp_games:
        warnings.append(
            f"{low_gp_games} game(s) had a team with fewer than {min_team_gp} prior games; "
            "early-season samples are small and noisy."
        )
    warnings.append(
        "Only players with a fixed position and at least one prior game are predicted; "
        "starters are taken from each box score's `started` flag."
    )
    return rows, warnings


def week_key(iso_date: str) -> str:
    """ISO week label (Monday-start), e.g. 2026-W43."""
    from datetime import date
    y, w, _ = date.fromisoformat(iso_date).isocalendar()
    return f"{y}-W{w:02d}"


_slug_re = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    return _slug_re.sub("_", name.strip().lower()).strip("_")

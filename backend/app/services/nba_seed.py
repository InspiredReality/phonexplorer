"""
Idempotent seeding for the NBA model.

    python -m app.services.nba_seed path/to/nba_box_scores_2026-27.csv

CSV columns: Date,Home_team,Away_team,Team,Player,Pos,Points  (optional: Started).
Re-running replaces each game's box lines and never overwrites a position an
admin has since edited.
"""
from __future__ import annotations

import asyncio
import csv
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.nba import NbaBoxLine, NbaFormulaVersion, NbaGame, NbaPlayer
from app.services.nba_model import map_pos, normalize_team

SEED_FORMULAS = [
    {
        "id": "v1_75_25",
        "name": "v1_75_25",
        "description": "pred = player_avg + 0.25 * adj, where adj = opponent's points allowed per game "
                       "to the player's position minus the league average for that position.",
        "params": {"w_avg": 1.0, "w_adj": 0.25, "variables": ["player_avg", "pos_defense_adj"]},
    },
    {
        "id": "v1_literal",
        "name": "v1_literal",
        "description": "Original wording: pred = player_avg*0.75 + adj*0.25. Drops 25% of the player's "
                       "scoring, so expected to grade worse than v1_75_25.",
        "params": {"w_avg": 0.75, "w_adj": 0.25, "variables": ["player_avg", "pos_defense_adj"]},
    },
]


async def seed_formulas(db: AsyncSession) -> None:
    for f in SEED_FORMULAS:
        if await db.get(NbaFormulaVersion, f["id"]) is None:
            db.add(NbaFormulaVersion(**f, locked=False))
    await db.commit()


def parse_iso_date(raw: str) -> str:
    raw = raw.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError(f"Unrecognised date: {raw!r}")


async def seed_box_csv(db: AsyncSession, path: str | Path) -> dict:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))

    games: dict[str, dict] = {}
    pos_votes: dict[tuple[str, str], Counter] = defaultdict(Counter)
    per_team_seen: dict[tuple[str, str], int] = defaultdict(int)
    for r in rows:
        iso = parse_iso_date(r["Date"])
        home, away = normalize_team(r["Home_team"]), normalize_team(r["Away_team"])
        team = normalize_team(r["Team"])
        gid = f"{iso.replace('-', '')}{away}{home}"
        g = games.setdefault(gid, {"date": iso, "home": home, "away": away, "lines": []})
        raw_pos = (r.get("Pos") or "").strip()
        n = per_team_seen[(gid, team)]
        per_team_seen[(gid, team)] += 1
        if "Started" in r and r["Started"].strip():
            started = r["Started"].strip().lower() in ("1", "true", "yes", "y")
        else:
            # Assumption: a box score lists its five starters first, in file order.
            started = n < 5
        g["lines"].append({
            "team": team, "player": r["Player"].strip(), "points": int(float(r["Points"])),
            "started": started, "listed_pos": raw_pos or None,
        })
        mapped = map_pos(raw_pos)
        if mapped:
            pos_votes[(team, r["Player"].strip())][mapped] += 1

    for gid, g in games.items():
        game = await db.get(NbaGame, gid)
        scores = {t: sum(l["points"] for l in g["lines"] if l["team"] == t) for t in (g["home"], g["away"])}
        if game is None:
            game = NbaGame(id=gid, date=g["date"], home_team=g["home"], away_team=g["away"])
            db.add(game)
        game.home_score, game.away_score = scores[g["home"]], scores[g["away"]]
        game.status = "final"  # the CSV's totals were verified against final scores
        await db.execute(delete(NbaBoxLine).where(NbaBoxLine.game_id == gid))
        for l in g["lines"]:
            db.add(NbaBoxLine(game_id=gid, **l))

    new_players = 0
    for (team, player), votes in pos_votes.items():
        if await db.get(NbaPlayer, (team, player)) is None:
            db.add(NbaPlayer(team=team, player=player, pos=votes.most_common(1)[0][0]))
            new_players += 1
    # players seen only with unmappable labels stay unassigned
    for g in games.values():
        for l in g["lines"]:
            if (l["team"], l["player"]) not in pos_votes and await db.get(NbaPlayer, (l["team"], l["player"])) is None:
                db.add(NbaPlayer(team=l["team"], player=l["player"], pos=None))
                new_players += 1
    await db.commit()
    return {"games": len(games), "lines": len(rows), "new_players": new_players}


async def _main(path: str) -> None:
    from app.db import Base, SessionLocal, engine
    from app.models import nba as _nba  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        await seed_formulas(db)
        print(await seed_box_csv(db, path))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.services.nba_seed BOX_SCORES.csv")
    asyncio.run(_main(sys.argv[1]))

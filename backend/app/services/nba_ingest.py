"""
NBA box-score ingestion from landofbasketball.com.

Small per-day batches: `ingest_date` handles exactly one date, caches every
fetched page in `nba_page_cache`, waits between requests, honours robots.txt
and surfaces blocks (403/429) as `IngestBlocked` instead of working around them.
Re-running a date is idempotent: games are upserted by id and their box lines
replaced.

The HTML parsing is written against the structure described in the task
(daily summary links to `/box_scores/YYYY/MMDDAWYHOM.htm`; each box score has
a table per team with PTS and, for starters only, a position). It has NOT been
verified against live pages from this environment (the site is unreachable
from the build sandbox) — see README.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from urllib.robotparser import RobotFileParser
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.nba import (
    NbaBoxLine, NbaFormulaVersion, NbaGame, NbaPageCache, NbaPlayer, NbaPlayerAlias,
    NbaPrediction,
)
from app.services.nba_model import normalize_team

log = logging.getLogger(__name__)

BASE = "https://www.landofbasketball.com"
USER_AGENT = "phonexplorer-nba-model/1.0 (+personal research; low-volume, cached)"
REQUEST_DELAY_SECONDS = 1.5
EASTERN = ZoneInfo("America/New_York")

_BOX_HREF = re.compile(r"box_scores/(\d{4})/(\d{4})([A-Z]{3})([A-Z]{3})\.htm", re.I)


class IngestError(Exception):
    pass


class IngestBlocked(IngestError):
    """The site refused a request (403/429/robots). Never retried or bypassed."""


# ── HTML parsing (stdlib only) ─────────────────────────────────────────────────

class _Tables(HTMLParser):
    """Collects every <table> as rows of cell texts; also all link hrefs."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self.hrefs: list[str] = []
        self._stack: list[list[list[str]]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.hrefs.append(href)
        elif tag == "table":
            self._stack.append([])
        elif tag == "tr" and self._stack:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None and self._stack:
            if self._row:
                self._stack[-1].append(self._row)
            self._row = None
        elif tag == "table" and self._stack:
            self.tables.append(self._stack.pop())

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def parse_daily_links(html: str) -> list[tuple[str, str, str, str]]:
    """-> [(year, mmdd, away_code, home_code)] for each linked box score, deduped."""
    p = _Tables()
    p.feed(html)
    seen, out = set(), []
    for href in p.hrefs:
        m = _BOX_HREF.search(href)
        if m and m.group(0) not in seen:
            seen.add(m.group(0))
            out.append(m.groups())
    return out


def parse_box_score(html: str) -> list[dict]:
    """-> one dict per team table, in page order (away first, then home).

    {"lines": [{"player", "points", "started", "listed_pos"}], "total": int | None}
    A player table is any table whose header row has a PTS column. Rows whose
    PTS cell is not a number (DNP, Inactive, ...) are skipped. A "Totals" row
    supplies the team's final points.
    """
    p = _Tables()
    p.feed(html)
    teams = []
    for rows in p.tables:
        head_idx = next(
            (i for i, r in enumerate(rows) if any(c.strip().upper() == "PTS" for c in r)), None
        )
        if head_idx is None:
            continue
        head = [c.strip().upper() for c in rows[head_idx]]
        pts_i = head.index("PTS")
        name_i = next((i for i, c in enumerate(head) if c in ("PLAYER", "NAME")), 0)
        pos_i = next((i for i, c in enumerate(head) if c in ("POS", "POSITION")), None)
        lines, total = [], None
        for r in rows[head_idx + 1:]:
            if len(r) <= max(pts_i, name_i):
                continue
            name, pts = r[name_i].strip(), r[pts_i].strip()
            if name.lower().startswith("total"):
                total = int(pts) if pts.isdigit() else None
                continue
            if not name or not pts.isdigit():
                continue  # DNP / inactive / spacer
            raw_pos = r[pos_i].strip() if pos_i is not None and pos_i < len(r) else ""
            lines.append({
                "player": name, "points": int(pts),
                "started": bool(raw_pos), "listed_pos": raw_pos or None,
            })
        if lines:
            teams.append({"lines": lines, "total": total})
    return teams


# ── Fetching ───────────────────────────────────────────────────────────────────

class Fetcher:
    def __init__(self, db: AsyncSession, client: httpx.AsyncClient):
        self.db, self.client = db, client
        self._robots: RobotFileParser | None = None
        self._last_request = 0.0

    async def _allowed(self, url: str) -> bool:
        if self._robots is None:
            rp = RobotFileParser()
            try:
                resp = await self.client.get(f"{BASE}/robots.txt", headers={"User-Agent": USER_AGENT})
                if resp.status_code in (401, 403):
                    raise IngestBlocked(f"robots.txt returned {resp.status_code}")
                rp.parse(resp.text.splitlines() if resp.status_code == 200 else [])
            except httpx.HTTPError as exc:
                raise IngestError(f"could not fetch robots.txt: {exc}") from exc
            self._robots = rp
        return self._robots.can_fetch(USER_AGENT, url)

    async def get(self, url: str, *, refresh: bool = False) -> str:
        if not refresh:
            cached = await self.db.get(NbaPageCache, url)
            if cached:
                return cached.body
        if not await self._allowed(url):
            raise IngestBlocked(f"robots.txt disallows {url}")
        wait = REQUEST_DELAY_SECONDS - (asyncio.get_event_loop().time() - self._last_request)
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            resp = await self.client.get(url, headers={"User-Agent": USER_AGENT})
        except httpx.HTTPError as exc:
            raise IngestError(f"fetch failed for {url}: {exc}") from exc
        finally:
            self._last_request = asyncio.get_event_loop().time()
        if resp.status_code in (401, 403, 429):
            raise IngestBlocked(f"{url} returned {resp.status_code}; not retrying or working around it")
        if resp.status_code == 404:
            raise IngestError(f"{url} not found (404)")
        if resp.status_code != 200:
            raise IngestError(f"{url} returned {resp.status_code}")
        existing = await self.db.get(NbaPageCache, url)
        if existing:
            existing.body = resp.text
        else:
            self.db.add(NbaPageCache(url=url, body=resp.text))
        await self.db.commit()
        return resp.text


# ── Players ────────────────────────────────────────────────────────────────────

async def resolve_player(db: AsyncSession, team: str, name: str) -> tuple[str, bool]:
    """Canonical player name via aliases. Returns (name, created_unassigned)."""
    alias = await db.get(NbaPlayerAlias, (team, name))
    if alias:
        return alias.player, False
    if await db.get(NbaPlayer, (team, name)):
        return name, False
    db.add(NbaPlayer(team=team, player=name, pos=None))  # unassigned until a human sets it
    return name, True


# ── Ingestion ──────────────────────────────────────────────────────────────────

async def _store_game(
    db: AsyncSession, game_id: str, iso: str, away: str, home: str, url: str,
    teams: list[dict], report: dict,
) -> None:
    if len(teams) != 2:
        raise IngestError(f"{url}: expected 2 team tables, found {len(teams)}")

    game = await db.get(NbaGame, game_id)
    was_new = game is None
    if was_new:
        game = NbaGame(id=game_id, date=iso, home_team=home, away_team=away, source_url=url)
        db.add(game)
    await db.execute(delete(NbaBoxLine).where(NbaBoxLine.game_id == game_id))

    sums, totals = {}, {}
    for team, tbl in zip((away, home), teams):  # page order: away table first
        merged: dict[str, dict] = {}
        for ln in tbl["lines"]:
            name, created = await resolve_player(db, team, ln["player"])
            if created:
                report["unknown_players"].append({"team": team, "player": name})
            if name in merged:  # alias collision inside one box: keep points once, sum defensively
                merged[name]["points"] += ln["points"]
                merged[name]["started"] |= ln["started"]
            else:
                merged[name] = {**ln, "player": name}
        for ln in merged.values():
            db.add(NbaBoxLine(
                game_id=game_id, team=team, player=ln["player"], points=ln["points"],
                started=ln["started"], listed_pos=ln["listed_pos"],
            ))
        sums[team] = sum(ln["points"] for ln in merged.values())
        totals[team] = tbl["total"]

    ok = all(totals[t] is not None and totals[t] == sums[t] for t in (away, home))
    for t in (away, home):
        if totals[t] is None or totals[t] != sums[t]:
            report["mismatches"].append({
                "game_id": game_id, "team": t, "box_total": sums[t], "final": totals[t],
            })
    game.away_score, game.home_score = totals[away], totals[home]
    game.status = "final" if ok else "pending_review"
    if was_new:
        report["games_added"] += 1
    await db.flush()
    if ok:
        await lock_graded(db, game_id)


async def lock_graded(db: AsyncSession, game_id: str) -> None:
    """Final game => its predictions and their formulas become immutable."""
    await db.execute(update(NbaPrediction).where(NbaPrediction.game_id == game_id).values(locked=True))
    fids = (await db.execute(
        select(NbaPrediction.formula_id).where(NbaPrediction.game_id == game_id).distinct()
    )).scalars().all()
    if fids:
        await db.execute(update(NbaFormulaVersion).where(NbaFormulaVersion.id.in_(fids)).values(locked=True))


async def ingest_date(db: AsyncSession, client: httpx.AsyncClient, day: date, report: dict | None = None) -> dict:
    report = report if report is not None else {"games_added": 0, "mismatches": [], "unknown_players": []}
    fetcher = Fetcher(db, client)
    today = datetime.now(EASTERN).date()
    # A day that is fully in the past is settled, so its summary page may come from cache;
    # today's (and yesterday's, which can still be finishing late) is always re-fetched.
    summary = await fetcher.get(
        f"{BASE}/nba_daily_summary/{day:%Y%m%d}.htm", refresh=day >= today - timedelta(days=1)
    )
    for year, mmdd, away_raw, home_raw in parse_daily_links(summary):
        away, home = normalize_team(away_raw), normalize_team(home_raw)
        iso = f"{year}-{mmdd[:2]}-{mmdd[2:]}"
        game_id = f"{iso.replace('-', '')}{away}{home}"
        existing = await db.get(NbaGame, game_id)
        if existing and existing.status == "final":
            continue  # idempotent: settled games are never re-fetched
        url = f"{BASE}/box_scores/{year}/{mmdd}{away_raw.upper()}{home_raw.upper()}.htm"
        try:
            html = await fetcher.get(url, refresh=True)
        except IngestBlocked:
            raise
        except IngestError as exc:
            log.warning("skipping %s: %s", game_id, exc)
            continue  # box not published yet (game in progress / not started)
        teams = parse_box_score(html)
        if not teams:
            continue
        await _store_game(db, game_id, iso, away, home, url, teams, report)
        await db.commit()
    return report

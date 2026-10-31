"""End-to-end API tests against in-memory SQLite (skipped if aiosqlite is not installed)."""
import tempfile
import unittest
from pathlib import Path

try:
    import aiosqlite  # noqa: F401
    HAVE_SQLITE = True
except ImportError:
    HAVE_SQLITE = False

from app.services import nba_ingest

CSV = """Date,Home_team,Away_team,Team,Player,Pos,Points
2026-10-20,Detroit Pistons,Boston Celtics,Boston Celtics,Tatum,F,30
2026-10-20,Detroit Pistons,Boston Celtics,Boston Celtics,White,G,10
2026-10-20,Detroit Pistons,Boston Celtics,Boston Celtics,Horford,C,5
2026-10-20,Detroit Pistons,Boston Celtics,Detroit Pistons,Cunningham,G,25
2026-10-20,Detroit Pistons,Boston Celtics,Detroit Pistons,Duren,C,15
2026-10-20,Detroit Pistons,Boston Celtics,Detroit Pistons,Mystery,,4
2026-10-22,Boston Celtics,Detroit Pistons,Boston Celtics,Tatum,F,26
2026-10-22,Boston Celtics,Detroit Pistons,Boston Celtics,White,G,14
2026-10-22,Boston Celtics,Detroit Pistons,Detroit Pistons,Cunningham,G,20
2026-10-22,Boston Celtics,Detroit Pistons,Detroit Pistons,Duren,C,18
"""

BOX_HTML = """<html><body>
<table><tr><th>Player</th><th>Pos</th><th>MIN</th><th>PTS</th></tr>
<tr><td>J. Tatum</td><td>SF</td><td>36</td><td>30</td></tr>
<tr><td>Bench Guy</td><td></td><td>12</td><td>6</td></tr>
<tr><td>Hurt Guy</td><td></td><td>DNP</td><td>DNP</td></tr>
<tr><td>Totals</td><td></td><td>240</td><td>36</td></tr></table>
<table><tr><th>Player</th><th>Pos</th><th>MIN</th><th>PTS</th></tr>
<tr><td>C. Cunningham</td><td>PG</td><td>35</td><td>25</td></tr>
<tr><td>Totals</td><td></td><td>240</td><td>25</td></tr></table></body></html>"""


class Parser(unittest.TestCase):
    def test_daily_links(self):
        html = '<a href="/box_scores/2026/1020BOSDET.htm">x</a><a href="/box_scores/2026/1020BOSDET.htm">dup</a>'
        self.assertEqual(nba_ingest.parse_daily_links(html), [("2026", "1020", "BOS", "DET")])

    def test_box(self):
        teams = nba_ingest.parse_box_score(BOX_HTML)
        self.assertEqual(len(teams), 2)
        away = teams[0]
        self.assertEqual(away["total"], 36)
        self.assertEqual([(l["player"], l["points"], l["started"]) for l in away["lines"]],
                         [("J. Tatum", 30, True), ("Bench Guy", 6, False)])  # DNP skipped


@unittest.skipUnless(HAVE_SQLITE, "aiosqlite not installed")
class Api(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import httpx
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
        from sqlalchemy.pool import StaticPool

        from app.config import settings
        from app.core.deps import get_db
        from app.db import Base
        from app.main import app
        from app.models import nba as nba_models
        from app.services.nba_seed import seed_box_csv, seed_formulas

        settings.admin_token = "t"
        self.engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
        async with self.engine.begin() as conn:
            await conn.run_sync(lambda c: Base.metadata.create_all(
                c, tables=[t for t in Base.metadata.sorted_tables if t.name.startswith("nba_")]))
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)

        async def override():
            async with self.Session() as s:
                yield s

        app.dependency_overrides[get_db] = override
        self.app = app
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "box.csv"
            p.write_text(CSV)
            async with self.Session() as db:
                await seed_formulas(db)
                self.seed = await seed_box_csv(db, p)
                self.seed2 = await seed_box_csv(db, p)  # idempotent
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        self.auth = {"Authorization": "Bearer t"}

    async def asyncTearDown(self):
        self.app.dependency_overrides.clear()
        await self.http.aclose()
        await self.engine.dispose()

    async def test_seed_idempotent_and_reads(self):
        self.assertEqual(self.seed["games"], 2)
        self.assertEqual(self.seed2["new_players"], 0)
        games = (await self.http.get("/api/nba/games")).json()
        self.assertEqual([g["id"] for g in games], ["20261020BOSDET", "20261022DETBOS"])
        self.assertEqual((games[0]["home_score"], games[0]["away_score"]), (44, 45))  # DET 25+15+4, BOS 30+10+5
        box = (await self.http.get("/api/nba/games/20261020BOSDET/box")).json()
        self.assertEqual(len(box), 6)
        self.assertEqual(len((await self.http.get("/api/nba/formulas")).json()), 2)

    async def test_unassigned_flagged_and_excluded(self):
        un = (await self.http.get("/api/nba/players?unassigned=true")).json()
        self.assertEqual([(p["team"], p["player"]) for p in un], [("DET", "Mystery")])
        t = (await self.http.get("/api/nba/teams/allowed")).json()
        bos = next(r for r in t["teams"] if r["team"] == "BOS")
        # DET scored 25+15 (+4 unassigned excluded) then 20+18 against BOS
        self.assertEqual(sum(bos["allowed_total"].values()), 25 + 15 + 20 + 18)

    async def test_auth_required_for_writes(self):
        r = await self.http.put("/api/nba/players/DET/Mystery", json={"pos": "F"})
        self.assertEqual(r.status_code, 401)
        r = await self.http.put("/api/nba/players/DET/Mystery", json={"pos": "F"}, headers=self.auth)
        self.assertEqual(r.json()["pos"], "F")

    async def test_predict_accuracy_backtest_and_locking(self):
        from app.models.nba import NbaGame
        async with self.Session() as db:
            db.add(NbaGame(id="20261030BOSDET", date="2099-10-30", home_team="DET", away_team="BOS", status="scheduled"))
            await db.commit()
        body = {"game_id": "20261030BOSDET", "formula_ids": ["v1_75_25", "v1_literal"],
                "players": [{"team": "BOS", "player": "Tatum"}]}
        r = await self.http.post("/api/nba/predict", json=body, headers=self.auth)
        self.assertEqual(r.status_code, 200, r.text)
        preds = {p["formula_id"]: p for p in r.json()}
        self.assertAlmostEqual(preds["v1_75_25"]["player_avg"], 28.0)
        self.assertAlmostEqual(preds["v1_75_25"]["predicted"] - preds["v1_literal"]["predicted"], 0.25 * 28.0)
        self.assertIsNone(preds["v1_75_25"]["actual"])
        # re-predict overwrites rather than duplicating
        await self.http.post("/api/nba/predict", json=body, headers=self.auth)
        self.assertEqual(len((await self.http.get("/api/nba/predictions?game_id=20261030BOSDET")).json()), 2)
        # unassigned player rejected
        bad = {**body, "players": [{"team": "DET", "player": "Mystery2"}]}
        self.assertEqual((await self.http.post("/api/nba/predict", json=bad, headers=self.auth)).status_code, 422)
        # past game rejected
        past = {**body, "game_id": "20261022DETBOS"}
        self.assertEqual((await self.http.post("/api/nba/predict", json=past, headers=self.auth)).status_code, 409)

        # lineup candidates use only prior games
        lc = (await self.http.get("/api/nba/games/20261030BOSDET/lineup-candidates")).json()
        self.assertIn("Tatum", [c["player"] for c in lc])

        bt = (await self.http.post("/api/nba/backtest", json={"formula_ids": ["v1_75_25", "v1_literal"]}, headers=self.auth)).json()
        self.assertEqual(bt["baseline"]["n"], 4)  # game 2: four players, all with a prior game
        self.assertEqual({r["formula_id"] for r in bt["results"]}, {"v1_75_25", "v1_literal"})
        self.assertTrue(bt["warnings"])
        # backtest must not write predictions
        self.assertEqual(len((await self.http.get("/api/nba/predictions")).json()), 2)

    async def test_ingest_with_mock_site(self):
        import httpx
        from datetime import date
        from app.models.nba import NbaGame

        nba_ingest.REQUEST_DELAY_SECONDS = 0
        hits = []

        def handler(req: httpx.Request) -> httpx.Response:
            hits.append(req.url.path)
            if req.url.path == "/robots.txt":
                return httpx.Response(200, text="User-agent: *\nAllow: /")
            if req.url.path.startswith("/nba_daily_summary/"):
                return httpx.Response(200, text='<a href="/box_scores/2026/1105BOSDET.htm">box</a>')
            if req.url.path.endswith("1105BOSDET.htm"):
                return httpx.Response(200, text=BOX_HTML)
            return httpx.Response(404)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c, self.Session() as db:
            rep = await nba_ingest.ingest_date(db, c, date(2026, 11, 5))
            self.assertEqual(rep["games_added"], 1)
            self.assertEqual(rep["mismatches"], [])
            self.assertEqual({(u["team"], u["player"]) for u in rep["unknown_players"]},
                             {("BOS", "J. Tatum"), ("BOS", "Bench Guy"), ("DET", "C. Cunningham")})
            g = await db.get(NbaGame, "20261105BOSDET")
            self.assertEqual((g.status, g.away_score, g.home_score), ("final", 36, 25))
            n = len(hits)
            await nba_ingest.ingest_date(db, c, date(2026, 11, 5))  # settled game: no box re-fetch
            self.assertFalse(any(h.endswith("1105BOSDET.htm") for h in hits[n:]))

    async def test_ingest_mismatch_stays_unfinal_and_block_surfaces(self):
        import httpx
        from datetime import date
        from app.models.nba import NbaGame

        nba_ingest.REQUEST_DELAY_SECONDS = 0
        bad = BOX_HTML.replace("<td>240</td><td>25</td>", "<td>240</td><td>99</td>")

        def handler(req: httpx.Request) -> httpx.Response:
            if req.url.path == "/robots.txt":
                return httpx.Response(200, text="")
            if req.url.path.startswith("/nba_daily_summary/20261106"):
                return httpx.Response(403)
            if req.url.path.startswith("/nba_daily_summary/"):
                return httpx.Response(200, text='<a href="/box_scores/2026/1105BOSDET.htm">b</a>')
            return httpx.Response(200, text=bad)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c, self.Session() as db:
            rep = await nba_ingest.ingest_date(db, c, date(2026, 11, 5))
            self.assertEqual(rep["mismatches"], [{"game_id": "20261105BOSDET", "team": "DET", "box_total": 25, "final": 99}])
            self.assertEqual((await db.get(NbaGame, "20261105BOSDET")).status, "pending_review")
            with self.assertRaises(nba_ingest.IngestBlocked):
                await nba_ingest.ingest_date(db, c, date(2026, 11, 6))


if __name__ == "__main__":
    unittest.main()

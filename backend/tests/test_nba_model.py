"""Engine tests. Run from backend/:  python -m unittest discover -s tests -t .  (or pytest)"""
import csv
import unittest
from collections import defaultdict
from pathlib import Path

from app.services import nba_model as m

DATA = Path(__file__).parent / "data"
V1 = {"w_avg": 1.0, "w_adj": 0.25, "variables": ["player_avg", "pos_defense_adj"]}
LITERAL = {"w_avg": 0.75, "w_adj": 0.25, "variables": ["player_avg", "pos_defense_adj"]}

POS = {("A", "a1"): "G", ("A", "a2"): "C", ("B", "b1"): "G", ("B", "b2"): "C", ("A", "a3"): None}


def pos_of(team, player):
    return POS.get((team, player))


G1 = m.Game("g1", "2026-10-20", "A", "B")
G2 = m.Game("g2", "2026-10-21", "B", "A")
L1 = [m.Line("g1", "A", "a1", 20, True), m.Line("g1", "A", "a2", 10, True), m.Line("g1", "A", "a3", 7),
      m.Line("g1", "B", "b1", 10, True), m.Line("g1", "B", "b2", 4, True)]
L2 = [m.Line("g2", "A", "a1", 30, True), m.Line("g2", "B", "b1", 12, True)]


class PositionMapping(unittest.TestCase):
    def test_map(self):
        self.assertEqual([m.map_pos(x) for x in ("PG", "SG", "SF", "PF", "C", "G", "F")],
                         ["G", "G", "F", "F", "C", "G", "F"])
        self.assertIsNone(m.map_pos("G-F"))
        self.assertIsNone(m.map_pos(None))

    def test_team_names(self):
        self.assertEqual(m.normalize_team("Boston Celtics"), "BOS")
        self.assertEqual(m.normalize_team("celtics"), "BOS")
        self.assertEqual(m.normalize_team("DET"), "DET")
        self.assertEqual(m.normalize_team("Portland Trail Blazers"), "POR")
        with self.assertRaises(ValueError):
            m.normalize_team("Nowhere Bees")


class Engine(unittest.TestCase):
    def setUp(self):
        self.st = m.Stats(pos_of)
        self.st.add_game(G1, L1)

    def test_allowed_and_league(self):
        self.assertEqual(self.st.allowed_pg("B"), {"G": 20.0, "F": 0.0, "C": 10.0})
        # a3 is unassigned: its 7 points must not enter the position tables
        self.assertEqual(self.st.allowed["B"]["G"] + self.st.allowed["B"]["C"], 30.0)
        self.assertEqual(self.st.league_avg()["G"], 15.0)
        self.assertEqual(self.st.league_avg()["C"], 7.0)

    def test_v1_and_literal(self):
        # adj = 20 - 15 = 5
        pr = m.project(self.st, G2, "A", "a1", V1)
        self.assertAlmostEqual(pr.adj, 5.0)
        self.assertAlmostEqual(pr.predicted, 20 + 0.25 * 5)
        self.assertAlmostEqual(m.project(self.st, G2, "A", "a1", LITERAL).predicted, 20 * 0.75 + 0.25 * 5)

    def test_unassigned_and_no_games_not_predicted(self):
        self.assertIsNone(m.project(self.st, G2, "A", "a3", V1))
        self.assertIsNone(m.project(self.st, G2, "A", "nobody", V1))

    def test_team_table_shape(self):
        t = m.team_table(self.st)
        row = next(r for r in t["teams"] if r["team"] == "B")
        self.assertEqual(row["gp"], 1)
        self.assertEqual(row["vs_league"]["G"], 5.0)

    def test_extra_variables_plug_in(self):
        st = m.Stats(pos_of)
        st.add_game(G1, L1)
        st.add_game(G2, L2)
        g3 = m.Game("g3", "2026-10-22", "A", "B")
        params = {**V1, "variables": ["player_avg", "last_n_form"], "w_form": 0.5, "last_n": 1}
        pr = m.project(st, g3, "A", "a1", params)  # avg 25, last game 30 -> +0.5*5
        self.assertAlmostEqual(pr.predicted, 25 + 2.5)

    def test_validation(self):
        self.assertEqual(m.validate_params(V1), [])
        self.assertTrue(m.validate_params({"variables": ["pace"]}))
        self.assertTrue(m.validate_params({}))


class Backtest(unittest.TestCase):
    def test_no_leakage_and_starters_only(self):
        rows, warns = m.backtest([G1, G2], {"g1": L1, "g2": L2}, pos_of, {"v1": V1}, min_team_gp=5)
        # g1 has no prior games => no rows; g2 predicts starters a1, b1 (b2 did not play)
        self.assertEqual({(r.game_id, r.player) for r in rows}, {("g2", "a1"), ("g2", "b1")})
        a1 = next(r for r in rows if r.player == "a1")
        self.assertAlmostEqual(a1.predicted["v1"], 21.25)  # uses only g1
        self.assertEqual(a1.actual, 30)
        self.assertAlmostEqual(a1.baseline, 20)
        self.assertTrue(any("fewer than 5" in w for w in warns))

    def test_same_day_games_do_not_see_each_other(self):
        same = m.Game("g1b", "2026-10-20", "B", "A")
        rows, _ = m.backtest([G1, same], {"g1": L1, "g1b": L2}, pos_of, {"v1": V1})
        self.assertEqual(rows, [])


class Metrics(unittest.TestCase):
    def test_metrics(self):
        mt = m.metrics([(20, 18), (10, 16), (5, 5)])  # errors +2, -6, 0
        self.assertEqual(mt["n"], 3)
        self.assertAlmostEqual(mt["mae"], 8 / 3)
        self.assertAlmostEqual(mt["bias"], -4 / 3)
        self.assertAlmostEqual(mt["rmse"], (40 / 3) ** 0.5)
        self.assertAlmostEqual(mt["within3"], 2 / 3)
        self.assertAlmostEqual(mt["within5"], 2 / 3)
        self.assertIsNone(m.metrics([])["mae"])


# ── Reference numbers from the task (needs the real CSV) ───────────────────────

BOX_CSV = DATA / "nba_box_scores_2026-27.csv"


@unittest.skipUnless(BOX_CSV.exists(), f"seed CSV not present at {BOX_CSV}")
class ReferenceNumbers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app.services.nba_seed import parse_iso_date
        votes, games, lines = defaultdict(lambda: defaultdict(int)), {}, defaultdict(list)
        with open(BOX_CSV, newline="", encoding="utf-8-sig") as fh:
            for r in csv.DictReader(fh):
                iso = parse_iso_date(r["Date"])
                home, away = m.normalize_team(r["Home_team"]), m.normalize_team(r["Away_team"])
                team = m.normalize_team(r["Team"])
                gid = f"{iso.replace('-', '')}{away}{home}"
                games[gid] = m.Game(gid, iso, home, away)
                lines[gid].append(m.Line(gid, team, r["Player"].strip(), int(float(r["Points"]))))
                p = m.map_pos(r["Pos"])
                if p:
                    votes[(team, r["Player"].strip())][p] += 1
        pos = {k: max(v, key=v.get) for k, v in votes.items()}
        cls.st = m.Stats(lambda t, p: pos.get((t, p)))
        for g in sorted(games.values(), key=lambda g: (g.date, g.id)):
            cls.st.add_game(g, lines[g.id])

    def test_league_averages(self):
        lg = self.st.league_avg()
        self.assertAlmostEqual(lg["G"], 52.4, delta=0.1)
        self.assertAlmostEqual(lg["F"], 43.0, delta=0.1)
        self.assertAlmostEqual(lg["C"], 19.1, delta=0.1)

    def _proj(self, team, opp, name):
        game = m.Game("next", "2026-10-30", team, opp)
        for (t, p) in self.st.players:
            if t == team and (p == name or p.endswith(name)):
                return m.project(self.st, game, t, p, V1).predicted
        self.fail(f"{name} not found for {team}")

    def test_celtics_and_bulls(self):
        # Projections were made against each other's team ("Celtics v Bulls").
        for name, want in {"Tatum": 28.8, "George": 23.0, "White": 15.6, "Walsh": 9.1, "Robinson": 5.6}.items():
            self.assertAlmostEqual(self._proj("BOS", "CHI", name), want, delta=0.1, msg=name)
        for name, want in {"Powell": 20.3, "Wilson": 21.2, "Buzelis": 15.0, "Smith": 13.6, "Giddey": 6.3}.items():
            self.assertAlmostEqual(self._proj("CHI", "BOS", name), want, delta=0.1, msg=name)


if __name__ == "__main__":
    unittest.main()

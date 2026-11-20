import io
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(LAB)
sys.path.insert(0, os.path.join(LAB, "scripts"))

from qm import cli, engine  # noqa: E402
from qm.store import Workspace  # noqa: E402


class CliTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="qm-test-")
        shutil.copytree(os.path.join(ROOT, "config"), os.path.join(self.root, "config"))
        self.addCleanup(shutil.rmtree, self.root, True)

    def run_cli(self, *args, book="paper", day="2026-11-20"):
        buf = io.StringIO()
        with redirect_stdout(buf):
            cli.main(["--root", self.root, "--book", book, "--date", day, *map(str, args)])
        return buf.getvalue()

    def test_first_month_round_trip(self):
        self.run_cli("init")
        self.run_cli("deposit", 2000)
        self.run_cli("buy", "CASH", "--amount", 1200)
        self.run_cli("buy", "GOLD", "--amount", 400, "--price", 6500, "--fee-pct", 1)
        self.run_cli("buy", "INDEX", "--amount", 400, "--units", 193.2)
        ws = Workspace(self.root, "paper")
        pos = engine.positions(ws.ledger())
        self.assertAlmostEqual(pos["wallet"], 0.0)
        self.assertAlmostEqual(pos["units"]["GOLD"], 396 / 6500)
        self.assertAlmostEqual(ws.prices().get("INDEX", ws.ledger()[-1]["date"])[0], 400 / 193.2)

        # a month later the app shows 1,217.50 in the cash fund
        self.run_cli("mark", "CASH", 1217.5, day="2026-12-20")
        out = self.run_cli("status", day="2026-12-20")
        self.assertIn("stale_price", out)  # gold and index were not updated
        s = engine.summary(ws.config(), ws.ledger(), ws.prices(), ws.ledger()[-1]["date"].replace(month=12))
        self.assertAlmostEqual(s["total"], 1217.5 + 396 + 400)

    def test_cannot_spend_more_than_wallet(self):
        self.run_cli("init")
        self.run_cli("deposit", 100)
        with self.assertRaises(SystemExit):
            self.run_cli("buy", "CASH", "--amount", 500)

    def test_books_are_separate(self):
        self.run_cli("init")
        self.run_cli("deposit", 2000)
        self.run_cli("init", book="real")
        self.assertEqual(Workspace(self.root, "real").ledger(), [])
        self.assertEqual(len(Workspace(self.root, "paper").ledger()), 1)

    def test_report_files_are_written(self):
        self.run_cli("init")
        self.run_cli("deposit", 2000)
        out = os.path.join(self.root, "r.html")
        self.run_cli("report", "--out", out)
        with open(out, encoding="utf-8") as f:
            page = f.read()
        self.assertIn("dir='rtl'", page)
        self.assertIn("1,200", page)
        self.assertTrue(os.path.exists(os.path.join(self.root, "r.json")))

    def test_full_simulation_runs_clean(self):
        import simulate

        out_dir = os.path.join(self.root, "out")
        with redirect_stdout(io.StringIO()):
            simulate.main(out_dir)
        self.assertTrue(os.path.exists(os.path.join(out_dir, "sample-simulation.html")))


if __name__ == "__main__":
    unittest.main()

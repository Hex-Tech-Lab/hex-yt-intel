"""Tests for the commit guard (no network: Jev is stubbed). Run: python3 -m unittest scripts/commit-guard/test_commit_guard.py"""
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import commit_guard  # noqa: E402


def diff_for(path, lines):
    body = "\n".join("+" + line for line in lines)
    return f"diff --git a/{path} b/{path}\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{len(lines)} @@\n{body}\n"


def run_guard(diff_text, jev_answer=None, no_jev=False):
    with tempfile.NamedTemporaryFile("w", suffix=".diff", delete=False) as handle:
        handle.write(diff_text)
    argv = ["commit_guard.py", "--diff-file", handle.name] + (["--no-jev"] if no_jev else [])
    out = io.StringIO()
    with mock.patch.object(sys, "argv", argv), mock.patch.object(commit_guard, "decide", return_value=jev_answer), redirect_stdout(out):
        try:
            commit_guard.main()
            code = 0
        except SystemExit as exit_:
            code = exit_.code
    return code, out.getvalue()


def jev(private=0.0, secret=0.0):
    return {"private_material": {"noul": private}, "secret_like": {"noul": secret}}


class CommitGuardTest(unittest.TestCase):
    def test_clean_code_passes(self):
        code, out = run_guard(diff_for("web/lib/x.ts", ["export const a = 1;"]), jev(0.1, 0.1))
        self.assertEqual(code, 0)
        self.assertIn("PASS", out)

    def test_openrouter_key_blocks_without_echoing_it(self):
        key = "sk-or-v1-" + "a1b2c3d4" * 8  # commit-guard: allow
        code, out = run_guard(diff_for("web/lib/x.ts", [f"const k = '{key}';"]), jev())
        self.assertEqual(code, 1)
        self.assertNotIn(key, out)

    def test_jwt_blocks(self):
        jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnopqrstuv"  # commit-guard: allow
        self.assertEqual(run_guard(diff_for("scripts/x.ts", [jwt]), jev())[0], 1)

    def test_forbidden_paths_block(self):
        for path in ("worker/.dev.vars", "web/.env.local", ".env", "supabase/.temp/cli-latest", ".ori/state.sqlite", "certs/key.pem"):
            self.assertEqual(run_guard(diff_for(path, ["x"]), jev())[0], 1, path)

    def test_env_example_and_placeholder_assignments_pass(self):
        self.assertEqual(run_guard(diff_for(".env.example", ["OPENROUTER_API_KEY="]), jev())[0], 0)
        self.assertEqual(run_guard(diff_for("docs/setup.md", ["STREAM_HMAC_SECRET=${STREAM_HMAC_SECRET}"]), jev())[0], 0)

    def test_real_secret_assignment_blocks(self):
        self.assertEqual(run_guard(diff_for("docs/setup.md", ["OPENROUTER_API_KEY=abc123realvalue"]), jev())[0], 1)

    def test_allow_marker_skips_deterministic_check(self):
        line = "const fixture = 'sk-" + "x" * 30 + "'; // commit-guard: allow"
        self.assertEqual(run_guard(diff_for("web/lib/__tests__/t.ts", [line]), jev())[0], 0)

    def test_jev_bands(self):
        hunk = diff_for("docs/x.md", ["some text"])
        self.assertEqual(run_guard(hunk, jev(private=0.9))[0], 1)
        code, out = run_guard(hunk, jev(secret=0.6))
        self.assertEqual(code, 0)
        self.assertIn("FLAG", out)

    def test_jev_unavailable_never_blocks(self):
        code, out = run_guard(diff_for("docs/x.md", ["text"]), None)
        self.assertEqual(code, 0)
        self.assertIn("UNCHECKED", out)

    def test_jev_outage_costs_one_call(self):
        diff = diff_for("docs/a.md", ["a"]) + diff_for("docs/b.md", ["b"]) + diff_for("docs/c.md", ["c"])
        with mock.patch.object(commit_guard, "decide", return_value=None) as decide:
            with tempfile.NamedTemporaryFile("w", suffix=".diff", delete=False) as handle:
                handle.write(diff)
            with mock.patch.object(sys, "argv", ["commit_guard.py", "--diff-file", handle.name]), redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as exit_:
                    commit_guard.main()
        self.assertEqual(exit_.exception.code, 0)
        self.assertEqual(decide.call_count, 1)

    def test_thos_history_docs_are_allowed(self):
        self.assertEqual(run_guard(diff_for("docs/history/THOS_2026-10-08.md", ["# handover"]), jev(0.1, 0.1))[0], 0)


if __name__ == "__main__":
    unittest.main()

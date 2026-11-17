"""The analyze command must never delete or reuse a folder it does not own."""
import argparse
import tempfile
import unittest
from pathlib import Path

from sfr.cli import analyze
from sfr.common import save


def options(out: Path, source: str, force: bool = False) -> argparse.Namespace:
    return argparse.Namespace(input=source, out=out, force=force, skip="", scene=0.3, device="cpu", whisper="small")


class AnalyzeGuards(unittest.TestCase):
    def test_refuses_a_folder_that_is_not_an_earlier_run_even_with_force(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            keep = Path(tmp) / "notes.txt"
            keep.write_text("mine")
            self.assertEqual(analyze(options(Path(tmp), "https://example.com/v", force=True)), 2)
            self.assertTrue(keep.exists())

    def test_refuses_to_resume_with_a_different_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "run"
            save(out, "options", {"input": "https://example.com/a"})
            self.assertEqual(analyze(options(out, "https://example.com/b")), 2)


if __name__ == "__main__":
    unittest.main()

"""Guard: quiz HTML engines must not assign innerHTML / insertAdjacentHTML."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    ROOT / "templates" / "quiz_template.html",
    ROOT / "examples" / "demo.html",
]

SINK_RE = re.compile(
    r"""\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(""",
)


class NoHtmlSinksTest(unittest.TestCase):
    def test_quiz_pages_have_no_html_sinks(self):
        for path in FILES:
            text = path.read_text(encoding="utf-8")
            matches = SINK_RE.findall(text)
            self.assertEqual(matches, [], f"unsafe HTML sink still present in {path}")


if __name__ == "__main__":
    unittest.main()

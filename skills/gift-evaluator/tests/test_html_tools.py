"""Gift card HTML interpolates untrusted fields through html.escape."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from html_tools import _esc, _safe_src, generate_gift_card  # noqa: E402


XSS = '<img src=x onerror=alert(1)>'


class EscapeHelpersTest(unittest.TestCase):
    def test_esc_encodes_markup(self):
        self.assertEqual(_esc(XSS), "&lt;img src=x onerror=alert(1)&gt;")
        self.assertEqual(_esc(None), "")
        self.assertIn("&quot;", _esc('"quoted"'))

    def test_safe_src_rejects_javascript(self):
        self.assertEqual(_safe_src("javascript:alert(1)"), "")
        self.assertEqual(_safe_src("data:text/html,<script>"), "")
        self.assertTrue(_safe_src("https://example.com/a.png").startswith("https://"))
        self.assertTrue(_safe_src("data:image/png;base64,abc").startswith("data:image/"))


class GiftCardHtmlTest(unittest.TestCase):
    def test_user_fields_are_escaped(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "card.html"
            path = generate_gift_card(
                product_name=XSS,
                price=XSS,
                evaluation=XSS,
                thank_you_json=json.dumps([{"style": XSS, "content": XSS}]),
                return_gift_json=json.dumps([{"target": XSS, "item": XSS, "reason": XSS}]),
                vibe_code="standard",
                image_url="javascript:alert(1)",
                output_path=str(out),
            )
            self.assertTrue(Path(path).is_file())
            html = Path(path).read_text(encoding="utf-8")
            self.assertNotIn(XSS, html)
            self.assertNotIn("javascript:alert(1)", html)
            self.assertIn("&lt;img src=x onerror=alert(1)&gt;", html)


if __name__ == "__main__":
    unittest.main()

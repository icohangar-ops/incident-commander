"""Minimal parser tests: Office Open XML text extract + XXE rejection."""

from __future__ import annotations

import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from defusedxml.common import DefusedXmlException

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from quiz_mastery.file_parser import _parse_xml, parse_file  # noqa: E402

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"

SAFE_DOCX_XML = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}">
  <w:body>
    <w:p><w:r><w:t>Hello from docx</w:t></w:r></w:p>
  </w:body>
</w:document>
"""

SAFE_SLIDE_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="{A_NS}">
  <p:cSld>
    <p:spTree>
      <a:p><a:r><a:t>Hello from pptx</a:t></a:r></a:p>
    </p:spTree>
  </p:cSld>
</p:sld>
"""

XXE_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<w:document xmlns:w="{W_NS}">
  <w:body>
    <w:p><w:r><w:t>&xxe;</w:t></w:r></w:p>
  </w:body>
</w:document>
"""


def _write_zip(path: Path, entries: dict[str, str]) -> None:
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)


class FileParserTests(unittest.TestCase):
    def test_parse_docx_extracts_paragraph_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sample.docx"
            _write_zip(path, {"word/document.xml": SAFE_DOCX_XML})
            self.assertEqual(parse_file(str(path)), "Hello from docx")

    def test_parse_pptx_extracts_slide_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sample.pptx"
            _write_zip(path, {"ppt/slides/slide1.xml": SAFE_SLIDE_XML})
            self.assertEqual(parse_file(str(path)), "[Slide 1]\nHello from pptx")

    def test_xml_parser_rejects_external_entities(self) -> None:
        with self.assertRaises(DefusedXmlException):
            _parse_xml(io.BytesIO(XXE_XML.encode("utf-8")))

    def test_docx_with_xxe_does_not_leak_file_contents(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "evil.docx"
            _write_zip(path, {"word/document.xml": XXE_XML})
            with self.assertRaises(DefusedXmlException):
                parse_file(str(path))


if __name__ == "__main__":
    unittest.main()

"""Syntax colors survive the native text export contract without a bitmap."""

from xml.etree import ElementTree as ET
from zipfile import ZipFile

from tests.presentation_helpers import sample_document

from app.apps.presentation_workshop.pptx_export import write_pptx


def test_highlighted_native_runs_preserve_source_colors_and_empty_lines(tmp_path):
    doc = sample_document()
    item = doc.slides[0].elements[0]
    sample_run = item.paragraphs[0].runs[0]
    sample_paragraph = item.paragraphs[0]
    lines = [
        [("{", "#26364A")],
        [("  ", "#26364A"), ('"status"', "#165EAB"), (": ", "#26364A"), ('"claimed"', "#19733D")],
        [("", "#26364A")],
        [("}", "#26364A")],
    ]
    item.paragraphs = [
        sample_paragraph.model_copy(
            update={
                "bullet": False,
                "runs": [
                    sample_run.model_copy(
                        update={"text": text, "color": color, "font": "Consolas", "size": 16}
                    )
                    for text, color in line
                ],
            }
        )
        for line in lines
    ]
    target = tmp_path / "code.pptx"
    write_pptx(doc, {}, target)
    with ZipFile(target) as archive:
        page = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
    ns = {
        "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    }
    paragraphs = page.findall(".//p:sp/p:txBody/a:p", ns)
    assert len(paragraphs) == len(lines)
    for paragraph, expected in zip(paragraphs, lines, strict=True):
        runs = paragraph.findall("a:r", ns)
        assert [
            (
                r.find("a:t", ns).text or "",
                "#" + r.find("a:rPr/a:solidFill/a:srgbClr", ns).get("val"),
            )
            for r in runs
        ] == expected
        assert all(r.find("a:rPr/a:latin", ns).get("typeface") == "Consolas" for r in runs)
    assert not page.findall(".//p:pic", ns)

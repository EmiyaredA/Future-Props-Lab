"""Native script typography must retain the editor's visible font size."""

import pytest
from pptx import Presentation
from pptx.util import Inches, Pt

from studio.apps.presentation_workshop.exchange.pptx_import import read_pptx
from studio.apps.presentation_workshop.pptx_export import write_pptx
from studio.apps.presentation_workshop.schemas.document import PresentationDocument
from tests.presentation_helpers import sample_document


@pytest.mark.parametrize("script,baseline", [("sup", 30000), ("sub", -25000)])
@pytest.mark.parametrize("size", [6, 8, 24, 240])
def test_native_scripts_keep_visible_size_through_repeated_exchange(
    tmp_path, script, baseline, size
):
    source = sample_document().model_dump()
    item = source["slides"][0]["elements"][0]
    base = item["paragraphs"][0]["runs"][0]
    item["paragraphs"][0]["runs"] = [
        {**base, "text": "pass@k = 1 − (1 − p)", "size": 11, "script": "normal"},
        {**base, "text": "k\ni", "size": size, "script": script},
        {**base, "text": " = p", "size": 11, "script": "normal"},
    ]
    document = PresentationDocument.model_validate(source)
    original = document.model_dump()
    for generation in range(3):
        target = tmp_path / f"scripts-{generation}.pptx"
        write_pptx(document, {}, target)
        native = Presentation(target).slides[0].shapes[0].text_frame.paragraphs[0]
        # Office scales a baseline-shifted run to 65% of its nominal font size.
        # Test the resulting size, rather than accepting baseline alone as proof.
        assert [r.text for r in native.runs] == ["pass@k = 1 − (1 − p)", "k", "i", " = p"]
        for index in (1, 2):
            assert int(native.runs[index]._r.rPr.get("baseline")) == baseline
            assert native.runs[index].font.size.pt * 0.65 / 0.75 == pytest.approx(size, abs=0.03)
        for index in (0, 3):
            assert native.runs[index]._r.rPr.get("baseline") is None
            assert native.runs[index].font.size.pt == 8.25
        if generation == 0:
            assert document.model_dump() == original
        document = read_pptx(target.read_bytes(), "scripts").document
        restored = document.slides[0].elements[0].paragraphs[0].runs
        scripts = [r for r in restored if r.script == script]
        assert len(scripts) == 2
        assert all(r.size == pytest.approx(size, abs=0.03) for r in scripts)


@pytest.mark.parametrize("baseline,scale", [(None, 1), (0, 1), (30000, 0.65), (-25000, 0.65)])
def test_import_native_text_size_matches_displayed_size(tmp_path, baseline, scale):
    deck = Presentation()
    page = deck.slides.add_slide(deck.slide_layouts[6])
    run = (
        page.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1))
        .text_frame.paragraphs[0]
        .add_run()
    )
    run.text = "k"
    run.font.name = "Arial"
    run.font.size = Pt(10)
    if baseline is not None:
        run._r.get_or_add_rPr().set("baseline", str(baseline))
    target = tmp_path / "external.pptx"
    deck.save(target)
    imported = read_pptx(target.read_bytes(), "external").document
    restored = imported.slides[0].elements[0].paragraphs[0].runs[0]
    assert restored.size == pytest.approx(10 / 0.75 * scale)

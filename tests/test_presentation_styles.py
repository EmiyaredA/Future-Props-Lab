import json
import sqlite3
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import pytest
from pydantic import ValidationError
from tests.presentation_helpers import element, sample_document

from app.presentation_workshop.pptx_export import write_pptx
from app.schemas.presentation_workshop import PresentationDocument, PresentationElement
from db.migrations.versions.r0057_presentation_styles import SQL


def test_style_migration_preserves_order_content_and_explicit_values(tmp_path):
    # Isolated storage fixture: never touch the running application's database.
    old = sample_document().model_dump()
    keys = ("fill_opacity", "stroke_dash", "start_arrow", "end_arrow", "corner_radius")
    for page in old["slides"]:
        for item in page["elements"]:
            for key in keys:
                item.pop(key)
    old["slides"][1]["elements"][0].update(fill_opacity=0, corner_radius=0, end_arrow="triangle")
    old["slides"].append({"id": "empty", "background": "#FFFFFF", "notes": "", "elements": []})
    with sqlite3.connect(tmp_path / "styles.db") as conn:
        conn.execute(
            "CREATE TABLE presentation_projects (id TEXT, document JSON, revision INTEGER)"
        )
        conn.execute(
            "INSERT INTO presentation_projects VALUES ('fixture', ?, 17)", (json.dumps(old),)
        )
        conn.executescript(SQL)
        once = conn.execute("SELECT document, revision FROM presentation_projects").fetchone()
        conn.executescript(SQL)
        assert (
            conn.execute("SELECT document, revision FROM presentation_projects").fetchone() == once
        )
    expected = PresentationDocument.model_validate(old).model_dump()
    assert json.loads(once[0]) == expected
    assert once[1] == 17


def test_legacy_defaults_and_element_limits():
    legacy = element()
    for key in ("fill_opacity", "stroke_dash", "start_arrow", "end_arrow", "corner_radius"):
        legacy.pop(key)
    item = PresentationElement.model_validate(legacy)
    assert (
        item.fill_opacity,
        item.stroke_dash,
        item.start_arrow,
        item.end_arrow,
        item.corner_radius,
    ) == (1, "solid", "none", "none", None)
    document = sample_document().model_dump()
    document["slides"][0]["elements"] = [element(id=f"limit-{i}") for i in range(200)]
    PresentationDocument.model_validate(document)
    document["slides"][0]["elements"].append(element(id="too-many"))
    with pytest.raises(ValidationError):
        PresentationDocument.model_validate(document)


@pytest.mark.parametrize(
    "patch",
    [
        {"fill_opacity": -0.1},
        {"fill_opacity": 1.1},
        {"corner_radius": -1},
        {"stroke_dash": "invalid"},
        {"end_arrow": "invalid"},
    ],
)
def test_style_bounds(patch):
    with pytest.raises(ValidationError):
        PresentationElement.model_validate(element(**patch))


def test_native_export_styles_and_monospace(tmp_path):
    doc = sample_document()
    doc.slides[0].elements = [
        PresentationElement.model_validate(
            element(
                "roundRect", id="transparent", fill_opacity=0, corner_radius=12, stroke_dash="dot"
            )
        ),
        PresentationElement.model_validate(
            element(
                "line",
                id="connection",
                rotation=135,
                stroke_dash="dash",
                start_arrow="triangle",
                end_arrow="triangle",
            )
        ),
        PresentationElement.model_validate(element(id="code")),
    ]
    doc.slides[0].elements[2].paragraphs[0].runs[0].font = "Consolas"
    target = tmp_path / "styles.pptx"
    write_pptx(doc, {}, target)
    with ZipFile(target) as archive:
        page = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
    ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
    assert page.find(".//a:alpha", ns).get("val") == "0"
    assert [n.get("val") for n in page.findall(".//a:prstDash", ns)] == ["sysDot", "dash"]
    assert page.find(".//a:headEnd", ns).get("type") == "triangle"
    assert page.find(".//a:tailEnd", ns).get("type") == "triangle"
    assert any(n.get("rot") == "8100000" for n in page.findall(".//a:xfrm", ns))
    assert page.find(".//a:gd", ns).get("fmla") == "val 5000"
    assert page.find(".//a:latin", ns).get("typeface") == "Consolas"

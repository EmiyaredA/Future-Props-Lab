import copy
import io
import itertools
import json

import httpx
import pytest
from pptx import Presentation
from tests.migration_fixtures import apply_migrations
from tests.presentation_helpers import sample_document

from app.apps.presentation_workshop.pptx_export import write_pptx
from app.apps.presentation_workshop.schemas.document import PresentationDocument
from app.main import app
from db.migrations import runner
from db.migrations.runner import connect_database


def test_v3_migration_preserves_content_order_and_revisions(tmp_path, monkeypatch):
    database = tmp_path / "v3.db"
    with monkeypatch.context() as before:
        before.setattr(
            runner,
            "MIGRATIONS",
            tuple(
                itertools.takewhile(
                    lambda m: m.migration_id != "0101_presentation_editor_v3", runner.MIGRATIONS
                )
            ),
        )
        apply_migrations(database)
    original = sample_document().model_dump()
    original["version"] = 2
    for slide in original["slides"]:
        for element in slide["elements"]:
            element.pop("name")
            element.pop("hidden")
    with connect_database(database) as connection:
        connection.execute(
            "INSERT INTO presentation_projects VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("legacy", "default", "旧稿", json.dumps(original), 7, "2026-01-01", "2026-01-02"),
        )
        connection.commit()
    apply_migrations(database)
    apply_migrations(database)
    with connect_database(database) as connection:
        row = connection.execute(
            "SELECT document, revision, updated_at FROM presentation_projects WHERE id='legacy'"
        ).fetchone()
        upgraded = json.loads(row[0])
        assert row[1:] == (7, "2026-01-02")
        assert not connection.execute("PRAGMA foreign_key_check").fetchall()
    assert upgraded["version"] == 3
    for slide in upgraded["slides"]:
        for element in slide["elements"]:
            assert element.pop("name") == ""
            assert element.pop("hidden") is False
    upgraded["version"] = 2
    assert upgraded == original


@pytest.mark.asyncio
async def test_v3_metadata_sizes_and_downgrade_protection():
    document = sample_document().model_dump()
    document.update(width=960, height=720)
    document["slides"][0]["elements"][0].update(name="标题", hidden=True)
    root = "/v1/presentation-workshop/projects"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(root, json={"title": "v3", "document": document})
        assert response.status_code == 200, response.text
        project = response.json()
        url = root + "/" + project["id"]
        summary = (await client.get(root)).json()["items"][0]
        assert (summary["width"], summary["height"]) == (960, 720)
        legacy = copy.deepcopy(document)
        legacy.update(version=2, width=1280)
        for slide in legacy["slides"]:
            for element in slide["elements"]:
                element.pop("name")
                element.pop("hidden")
        refused = await client.put(
            url, json={"title": "v3", "document": legacy, "expected_revision": 0}
        )
        assert refused.status_code == 422
        assert refused.json()["code"] == "document_downgrade"
        assert (await client.get(url)).json() == project
        exported = await client.post(url + "/export", json={"expected_revision": 0})
        assert exported.status_code == 200
        deck = Presentation(io.BytesIO(exported.content))
        assert deck.slide_width / deck.slide_height == pytest.approx(4 / 3)
        assert len(deck.slides[0].shapes) == 0
        assert len(deck.slides[1].shapes) == 2


def test_hidden_group_members_and_bound_edges_are_excluded_from_export(tmp_path):
    doc = sample_document().model_dump()
    page = doc["slides"][1]
    page["elements"][0]["hidden"] = True
    page["groups"] = [{"id": "group", "element_ids": [e["id"] for e in page["elements"]]}]
    page["connections"] = [
        {"id": "edge", "source_id": "shape-one", "target_id": "text-two", "layer": 1}
    ]
    path = tmp_path / "visible.pptx"
    write_pptx(PresentationDocument.model_validate(doc), {}, path)
    deck = Presentation(path)
    assert len(deck.slides[1].shapes) == 1
    assert len(deck.slides[1].shapes[0].shapes) == 1
    assert page["elements"][0]["hidden"] is True
    assert len(page["connections"]) == 1


def test_native_background_gradient_text_styles_and_links_round_trip(tmp_path):
    from pptx.oxml.ns import qn

    from app.apps.presentation_workshop.exchange.pptx_import import read_pptx

    doc = sample_document().model_dump()
    page = doc["slides"][0]
    page["background_style"] = {"type": "radial", "color": "#FFCC00", "end_color": "#005577"}
    item = page["elements"][0]
    item["paragraphs"][0]["runs"][0].update(strike=True, script="sup", highlight="#FFFF00")
    item["text_layout"] = {"vertical": True, "align": "middle", "padding": 12, "letter_spacing": 2}
    item["link"] = {"type": "slide", "target": doc["slides"][1]["id"]}
    shape = doc["slides"][1]["elements"][0]
    shape["paint"] = {"type": "linear", "color": "#FF0000", "end_color": "#0000FF", "angle": 45}
    shape["opacity"] = 0.5
    shape["flip_x"] = True
    file = tmp_path / "styles.pptx"
    write_pptx(PresentationDocument.model_validate(doc), {}, file)
    deck = Presentation(file)
    background = deck.slides[0]._element.cSld.bg.bgPr
    gradient = background.find(qn("a:gradFill"))
    assert gradient is not None
    names = [child.tag for child in gradient]
    assert qn("a:path") in names
    if qn("a:tileRect") in names:
        assert names.index(qn("a:path")) < names.index(qn("a:tileRect"))
    assert len(deck.slides[0].shapes) == 1
    props = deck.slides[0].shapes[0].text_frame.paragraphs[0].runs[0]._r.rPr
    assert props.get("strike") == "sngStrike"
    assert props.get("baseline") == "30000"
    assert props.find(qn("a:highlight")) is not None
    assert (
        deck.slides[1]
        .shapes[0]
        ._element.xpath("./p:spPr/a:gradFill/a:gsLst/a:gs/a:srgbClr/a:alpha")[0]
        .get("val")
        == "50000"
    )
    imported = read_pptx(file.read_bytes(), "styles")
    text = imported.document.slides[0].elements[0]
    assert text.link.target == imported.document.slides[1].id
    assert text.paragraphs[0].runs[0].script == "sup"
    assert imported.document.slides[1].elements[0].flip_x is True
    assert text.text_layout.vertical
    assert imported.document.slides[0].background_style.type == "radial"


@pytest.mark.asyncio
async def test_v3_preflight_cas_and_fragment_animation_is_not_lost():
    doc = sample_document().model_dump()
    root = "/v1/presentation-workshop/projects"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (await client.post(root, json={"title": "fragment", "document": doc})).json()
        url = root + "/" + project["id"]
        fragment = {
            "id": "group",
            "elements": [{**doc["slides"][1]["elements"][0], "id": "member"}],
            "groups": [{"id": "group", "element_ids": ["member"]}],
            "animations": [{"id": "animation", "element_id": "member", "effect": "fade"}],
        }
        applied = await client.post(
            url + "/operations",
            json={
                "expected_revision": 0,
                "request_id": "fragment-animation",
                "operations": [
                    {
                        "entity": "fragment",
                        "action": "insert",
                        "id": "group",
                        "parent_id": doc["slides"][0]["id"],
                        "fragment": fragment,
                    }
                ],
            },
        )
        assert applied.status_code == 200, applied.text
        assert applied.json()["document"]["slides"][0]["animations"][0]["id"] == "animation"
        preview = await client.post(url + "/export/preview", json={"expected_revision": 1})
        assert preview.status_code == 200, preview.text
        assert preview.json()["issues"][0]["code"] == "static_animation"
        stale = await client.post(url + "/export/preview", json={"expected_revision": 0})
        assert stale.status_code == 409


def test_hidden_media_does_not_require_reading_its_file(tmp_path):
    from pathlib import Path

    from app.apps.presentation_workshop.exports import build_export
    from app.apps.presentation_workshop.schemas.document import PresentationProjectOut

    document = sample_document().model_dump()
    element = document["slides"][0]["elements"][0]
    element.update(kind="vector", asset_id="hidden-file", paragraphs=[], hidden=True)
    snapshot = PresentationProjectOut.model_validate(
        {
            "id": "hidden",
            "title": "hidden",
            "revision": 0,
            "created_at": "2026-01-01T00:00:00",
            "updated_at": "2026-01-01T00:00:00",
            "document": document,
        }
    )
    result = build_export(snapshot, {"hidden-file": Path(tmp_path / "missing.svg")})
    try:
        assert len(Presentation(result.path).slides[0].shapes) == 0
    finally:
        result.cleanup()

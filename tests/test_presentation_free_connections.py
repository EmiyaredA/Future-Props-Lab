"""Free endpoints persist, copy and export independently of node geometry."""

import copy
import json
import sqlite3
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import httpx
import pytest
from pptx import Presentation
from pydantic import ValidationError
from tests.presentation_helpers import element, sample_document

from db.migrations.versions.r0104_presentation_free_connections import SQL
from studio.apps.presentation_workshop.connection_routes import follow_connection
from studio.apps.presentation_workshop.pptx_export import write_pptx
from studio.apps.presentation_workshop.scene_edits import remap
from studio.apps.presentation_workshop.schemas.document import PresentationDocument
from studio.apps.presentation_workshop.schemas.scene import PresentationConnection
from studio.apps.presentation_workshop.visible_scene import visible_scene
from website_test_support import app


def document(style="step"):
    doc = sample_document().model_dump()
    page = doc["slides"][0]
    page["elements"] = [element("rect", id="a", x=100, y=100, width=100, height=100)]
    page["connections"] = [
        {
            "id": "free",
            "source_point": {"x": 220, "y": 250},
            "target_point": {"x": 520, "y": 450},
            "style": style,
            "waypoints": [{"x": 370, "y": 250}, {"x": 370, "y": 450}] if style == "step" else [],
            "label": "自由连线",
        }
    ]
    return PresentationDocument.model_validate(doc)


@pytest.mark.parametrize(
    "invalid",
    [
        {},
        {"source_id": "a", "target_id": "a"},
        {"source_id": "a", "source_point": {"x": 1, "y": 2}, "target_id": "b"},
        {"source_point": {"x": float("nan"), "y": 0}, "target_id": "b"},
        {"source_point": {"x": 10001, "y": 0}, "target_id": "b"},
    ],
)
def test_endpoint_is_one_binding_or_finite_point(invalid):
    with pytest.raises(ValidationError):
        PresentationConnection(id="bad", **invalid)


def test_mixed_route_follows_only_bound_end_and_free_scene_survives_hidden_nodes():
    page = document().slides[0].model_dump()
    edge = page["connections"][0]
    edge.update(source_id="a", source_point=None)
    edge["waypoints"][0]["y"] = 150
    before = copy.deepcopy(page)
    after = copy.deepcopy(page)
    after["elements"][0]["y"] += 40
    moved = follow_connection(before, after, edge)
    assert moved["waypoints"] == [{"x": 370, "y": 190}, {"x": 370, "y": 450}]
    assert moved["target_point"] == {"x": 520, "y": 450}
    doc = document()
    doc.slides[0].elements[0].hidden = True
    visible = visible_scene(doc.slides[0])
    assert not visible.elements
    assert visible.connections[0].id == "free"


def test_copy_remaps_bound_ends_and_translates_free_points_once():
    page = document().slides[0].model_dump()
    page["connections"][0].update(source_id="a", source_point=None)
    result = remap(page, "copy", offset=24)
    assert result["connections"][0]["source_id"] == result["elements"][0]["id"]
    assert result["connections"][0]["target_id"] is None
    assert result["connections"][0]["target_point"] == {"x": 544, "y": 474}
    assert result["connections"][0]["waypoints"][0] == {"x": 394, "y": 274}
    assert page["connections"][0]["target_point"] == {"x": 520, "y": 450}


@pytest.mark.parametrize("style", ["straight", "step"])
def test_export_editable_free_line_keeps_exact_coordinates(tmp_path, style):
    doc = document(style)
    path = tmp_path / "free.pptx"
    write_pptx(doc, {}, path)
    deck = Presentation(path)
    shape = next(s for s in deck.slides[0].shapes if s.name == "free")
    assert shape.left == 220 * 9525
    assert shape.top == 250 * 9525
    assert shape.width == 300 * 9525
    assert shape.height == 200 * 9525
    with ZipFile(path) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
    ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
    assert not root.findall(".//a:stCxn", ns)
    assert not root.findall(".//a:endCxn", ns)
    assert root.find(".//a:tailEnd", ns) is not None


@pytest.mark.asyncio
async def test_api_save_rebind_copy_and_delete_node_keep_free_line():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/presentation-workshop/projects",
            json={"title": "free", "document": document().model_dump()},
        )
        assert created.status_code == 200, created.text
        project = created.json()
        url = f"/v1/presentation-workshop/projects/{project['id']}"
        data = project["document"]
        edge = data["slides"][0]["connections"][0]
        edge.update(source_id="a", source_point=None)
        response = await client.put(
            url, json={"title": "mixed", "document": data, "expected_revision": project["revision"]}
        )
        assert response.status_code == 200, response.text
        mixed = (await client.get(url)).json()
        assert mixed["document"]["slides"][0]["connections"][0]["target_point"] == {
            "x": 520,
            "y": 450,
        }
        edge.update(source_id=None, source_point={"x": 220, "y": 250})
        data["slides"][0]["elements"] = []
        response = await client.put(
            url, json={"title": "free", "document": data, "expected_revision": mixed["revision"]}
        )
        assert response.status_code == 200, response.text
        assert len((await client.get(url)).json()["document"]["slides"][0]["connections"]) == 1
        stale = await client.put(
            url, json={"title": "stale", "document": data, "expected_revision": mixed["revision"]}
        )
        assert stale.status_code == 409


def test_migration_preserves_nodes_paths_revisions_and_is_idempotent(tmp_path):
    old = document().model_dump()
    bound = {"id": "bound", "source_id": "a", "target_id": "b", "waypoints": [{"x": 3, "y": 4}]}
    old["slides"][0]["connections"].append(bound)
    expected = copy.deepcopy(old)
    expected["slides"][0]["connections"][-1].update(source_point=None, target_point=None)
    with sqlite3.connect(tmp_path / "migration.db") as db:
        db.execute(
            "CREATE TABLE presentation_projects(document JSON, revision INTEGER, updated_at TEXT)"
        )
        db.execute(
            "INSERT INTO presentation_projects VALUES (?, 41, 'untouched')", (json.dumps(old),)
        )
        db.executescript(SQL)
        first = db.execute("SELECT * FROM presentation_projects").fetchone()
        assert json.loads(first[0]) == expected
        assert first[1:] == (41, "untouched")
        db.executescript(SQL)
        assert db.execute("SELECT * FROM presentation_projects").fetchone() == first

import copy
import json
import sqlite3
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import httpx
import pytest
from pydantic import ValidationError
from tests.presentation_helpers import element, sample_document

from app.apps.presentation_workshop.connection_routes import (
    anchor,
    checked_waypoints,
    follow_connection,
)
from app.apps.presentation_workshop.pptx_export import write_pptx
from app.apps.presentation_workshop.schemas.document import PresentationDocument
from app.apps.presentation_workshop.schemas.scene import PresentationConnection
from app.main import app
from db.migrations.versions.r0100_presentation_connection_offsets import SQL

VECTORS = json.loads(
    (Path(__file__).parent / "fixtures/presentation_connection_routes.json").read_text()
)


def test_offset_migration_preserves_paths_order_and_metadata(tmp_path):
    old = document()
    first = old["slides"][0]
    first["connections"].append(
        {**first["connections"][0], "id": "existing", "source_offset": 0.2, "target_offset": 0.8}
    )
    old["slides"].append({"id": "empty", "elements": [], "connections": []})
    expected = copy.deepcopy(old)
    expected["slides"][0]["connections"][0].update(source_offset=0.5, target_offset=0.5)
    with sqlite3.connect(tmp_path / "migration.db") as connection:
        connection.execute(
            "CREATE TABLE presentation_projects(document JSON, revision INTEGER, updated_at TEXT)"
        )
        connection.execute(
            "INSERT INTO presentation_projects VALUES (?, 17, 'untouched')", (json.dumps(old),)
        )
        connection.executescript(SQL)
        saved = connection.execute("SELECT * FROM presentation_projects").fetchone()
        assert json.loads(saved[0]) == expected
        assert saved[1:] == (17, "untouched")
        connection.executescript(SQL)
        assert connection.execute("SELECT * FROM presentation_projects").fetchone() == saved


@pytest.mark.parametrize("vector", VECTORS, ids=lambda v: v["name"])
def test_follow_web_vectors(vector):
    before = {"elements": vector["elements"], "connections": [vector["edge"]]}
    after = copy.deepcopy(before)
    for node in after["elements"]:
        node.update(next((c for c in vector["changes"] if c["id"] == node["id"]), {}))
    result = follow_connection(before, after, after["connections"][0])
    assert result["waypoints"] == vector["expected"]
    assert before["connections"][0] == vector["edge"]


def test_offset_defaults_and_limits():
    assert PresentationConnection(id="e", source_id="a", target_id="b").source_offset == 0.5
    for value in (-0.1, 1.1, float("nan"), float("inf")):
        with pytest.raises(ValidationError):
            PresentationConnection(id="e", source_id="a", target_id="b", target_offset=value)
    with pytest.raises(ValueError, match="32"):
        checked_waypoints([{"x": i, "y": i % 2} for i in range(35)])


def document():
    doc = sample_document().model_dump()
    doc["slides"][0]["elements"] = [element("rect", **e) for e in VECTORS[0]["elements"]]
    doc["slides"][0]["connections"] = [copy.deepcopy(VECTORS[0]["edge"])]
    return doc


@pytest.mark.asyncio
@pytest.mark.parametrize("explicit", ["none", "before", "after"])
async def test_batch_combines_node_moves_and_prioritizes_explicit_paths(explicit):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/presentation-workshop/projects", json={"title": "route", "document": document()}
        )
        assert created.status_code == 200, created.text
        project = created.json()
        slide = project["document"]["slides"][0]
        operations = [
            {
                "entity": "element",
                "parent_id": slide["id"],
                "id": "a",
                "action": "update",
                "value": {"x": 140, "y": 130},
            },
            {
                "entity": "element",
                "parent_id": slide["id"],
                "id": "b",
                "action": "update",
                "value": {"x": 740, "y": 330},
            },
        ]
        explicit_points = [{"x": 450, "y": 180}, {"x": 450, "y": 380}]
        path_op = {
            "entity": "connection",
            "parent_id": slide["id"],
            "id": "edge",
            "action": "update",
            "value": {"waypoints": explicit_points},
        }
        if explicit == "before":
            operations.insert(0, path_op)
        elif explicit == "after":
            operations.append(path_op)
        url = f"/v1/presentation-workshop/projects/{project['id']}"
        response = await client.post(
            url + "/operations",
            json={
                "expected_revision": project["revision"],
                "request_id": "move-route",
                "operations": operations,
            },
        )
        assert response.status_code == 200, response.text
        expected = VECTORS[1]["expected"] if explicit == "none" else explicit_points
        assert response.json()["document"]["slides"][0]["connections"][0]["waypoints"] == expected
        assert (await client.get(url)).json()["document"]["slides"][0]["connections"][0][
            "waypoints"
        ] == expected


@pytest.mark.asyncio
async def test_fractional_panel_anchor_persists_and_follows_resize():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        data = document()
        data["slides"][0]["connections"][0].update(target_offset=0.2, waypoints=[])
        response = await client.post(
            "/v1/presentation-workshop/projects", json={"title": "panel", "document": data}
        )
        assert response.status_code == 200, response.text
        project = response.json()
        url = f"/v1/presentation-workshop/projects/{project['id']}"
        resized = await client.post(
            url + "/operations",
            json={
                "expected_revision": project["revision"],
                "request_id": "resize-panel",
                "operations": [
                    {
                        "entity": "element",
                        "parent_id": data["slides"][0]["id"],
                        "id": "b",
                        "action": "update",
                        "value": {"height": 200},
                    }
                ],
            },
        )
        assert resized.status_code == 200, resized.text
        page = (await client.get(url)).json()["document"]["slides"][0]
        assert page["connections"][0]["target_offset"] == 0.2
        assert anchor(page["elements"][1], "left", 0.2) == {"x": 700, "y": 340}


@pytest.mark.parametrize("style", ["step", "straight"])
def test_pptx_keeps_off_center_endpoints_and_editable_shape(tmp_path, style):
    data = document()
    page = data["slides"][0]
    page["connections"][0].update(style=style, source_offset=0.3, target_offset=0.2, waypoints=[])
    target = tmp_path / "offset.pptx"
    doc = PresentationDocument.model_validate(data)
    original = doc.model_dump_json()
    write_pptx(doc, {}, target)
    assert doc.model_dump_json() == original
    ns = {
        "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    }
    with ZipFile(target) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
    shape = next(
        s
        for s in root.findall(".//p:sp", ns)
        if s.find("p:nvSpPr/p:cNvPr", ns).get("name") == "edge"
    )
    off = shape.find("p:spPr/a:xfrm/a:off", ns)
    points = [
        (int(p.get("x")) + int(off.get("x")), int(p.get("y")) + int(off.get("y")))
        for p in shape.findall("p:spPr/a:custGeom/a:pathLst/a:path/*/a:pt", ns)
    ]
    assert points[0] == (300 * 9525, 130 * 9525)
    assert points[-1] == (700 * 9525, 320 * 9525)


@pytest.mark.asyncio
async def test_batch_route_limit_rejects_entire_node_move():
    data = document()
    points = [{"x": 500 + (i % 2) * 50, "y": 150 + i * 10} for i in range(32)]
    data["slides"][0]["connections"][0]["waypoints"] = points
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/presentation-workshop/projects", json={"title": "limit", "document": data}
        )
        assert created.status_code == 200, created.text
        project = created.json()
        url = f"/v1/presentation-workshop/projects/{project['id']}"
        response = await client.post(
            url + "/operations",
            json={
                "expected_revision": project["revision"],
                "request_id": "over-limit",
                "operations": [
                    {
                        "entity": "element",
                        "parent_id": data["slides"][0]["id"],
                        "id": "a",
                        "action": "update",
                        "value": {"y": 130},
                    }
                ],
            },
        )
        assert response.status_code == 422, response.text
        saved = (await client.get(url)).json()
        assert saved["revision"] == project["revision"]
        assert saved["document"]["slides"][0]["elements"][0]["y"] == 100
        assert saved["document"]["slides"][0]["connections"][0]["waypoints"] == points

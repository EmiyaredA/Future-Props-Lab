import copy
import json
import sqlite3
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import httpx
import pytest
from pydantic import ValidationError
from tests.test_presentation_scene import scene_document

from app.apps.presentation_workshop.pptx_export import write_pptx
from app.apps.presentation_workshop.schemas.document import PresentationDocument
from app.main import app
from db.migrations.versions.r0098_presentation_connection_layers import SQL

NS = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main"}


def test_layer_migration_only_fills_missing_defaults_and_preserves_metadata(tmp_path):
    data = scene_document()
    second = copy.deepcopy(data["slides"][0])
    second["id"] = "second"
    second["connections"][0]["layer"] = 2
    data["slides"].append(second)
    data["slides"].append({"id": "empty", "elements": [], "connections": []})
    with sqlite3.connect(tmp_path / "layers.db") as connection:
        connection.execute(
            "CREATE TABLE presentation_projects(document JSON, revision INT, updated_at TEXT)"
        )
        connection.execute(
            "INSERT INTO presentation_projects VALUES (?, 9, 'original')", (json.dumps(data),)
        )
        connection.executescript(SQL)
        result = connection.execute("SELECT * FROM presentation_projects").fetchone()
        expected = copy.deepcopy(data)
        expected["slides"][0]["connections"][0]["layer"] = 0
        assert json.loads(result[0]) == expected
        assert result[1:] == (9, "original")
        connection.executescript(SQL)
        assert connection.execute("SELECT * FROM presentation_projects").fetchone() == result


@pytest.mark.parametrize("layer", [-1, 201, 1.5])
def test_invalid_layers_rejected(layer):
    data = scene_document()
    data["slides"][0]["connections"][0]["layer"] = layer
    with pytest.raises(ValidationError):
        PresentationDocument.model_validate(data)


@pytest.mark.parametrize("layer", [0, 1, 3, 200])
@pytest.mark.parametrize("grouped", [False, True])
def test_pptx_uses_same_connection_layer_and_keeps_labels_together(tmp_path, layer, grouped):
    data = scene_document()
    page = data["slides"][0]
    page["connections"][0]["layer"] = layer
    page["connections"].append(
        {"id": "second", "source_id": "node-b", "target_id": "label-a", "layer": layer}
    )
    if not grouped:
        page.update(groups=[], infographics=[])
    target = tmp_path / "layers.pptx"
    write_pptx(PresentationDocument.model_validate(data), {}, target)
    with ZipFile(target) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
    identities = [n.get("name") for n in root.findall(".//p:cNvPr", NS)]
    painted = [
        i
        for i in identities
        if i in {"node-a", "node-b", "label-a", "edge", "edge-label", "second"}
    ]
    expected = ["node-a", "node-b", "label-a"]
    slot = min(layer, len(expected))
    expected[slot:slot] = ["edge", "edge-label", "second"]
    assert painted == expected


@pytest.mark.asyncio
async def test_layers_survive_save_reload_batch_edit_and_node_removal():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        data = scene_document()
        data["slides"][0]["connections"][0]["layer"] = 1
        created = await client.post(
            "/v1/presentation-workshop/projects", json={"title": "layers", "document": data}
        )
        assert created.status_code == 200, created.text
        project = created.json()
        url = f"/v1/presentation-workshop/projects/{project['id']}"
        assert (await client.get(url)).json()["document"]["slides"][0]["connections"][0][
            "layer"
        ] == 1
        result = await client.post(
            url + "/operations",
            json={
                "expected_revision": 0,
                "request_id": "lower-layer",
                "operations": [
                    {
                        "entity": "connection",
                        "action": "update",
                        "parent_id": "slide-one",
                        "id": "edge",
                        "value": {"layer": 3},
                    },
                    {
                        "entity": "element",
                        "action": "remove",
                        "parent_id": "slide-one",
                        "id": "label-a",
                    },
                ],
            },
        )
        assert result.status_code == 200, result.text
        edge = result.json()["document"]["slides"][0]["connections"][0]
        assert edge["layer"] == 2
        assert edge["waypoints"] == data["slides"][0]["connections"][0]["waypoints"]

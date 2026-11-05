import copy
import json
import sqlite3
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import httpx
import pytest
from pydantic import ValidationError
from tests.presentation_helpers import element, sample_document

from db.migrations.versions.r0096_presentation_scene import SQL
from studio.apps.presentation_workshop.pptx_export import write_pptx
from studio.apps.presentation_workshop.schemas.document import PresentationDocument
from website_test_support import app


def scene_document():
    data = sample_document().model_dump()
    page = data["slides"][0]
    page["elements"] = [
        element("rect", id="node-a", x=100, width=200),
        element("rect", id="node-b", x=800, width=200),
        element(id="label-a", width=180),
    ]
    page["groups"] = [
        {"id": "root", "name": "流程", "element_ids": ["node-b"], "parent_id": None},
        {"id": "child", "name": "节点", "element_ids": ["node-a", "label-a"], "parent_id": "root"},
    ]
    page["connections"] = [
        {
            "id": "edge",
            "source_id": "node-a",
            "target_id": "node-b",
            "label": "内容",
            "waypoints": [{"x": 650, "y": 220}, {"x": 650, "y": 320}],
        }
    ]
    page["infographics"] = [
        {
            "id": "source",
            "group_id": "root",
            "format": "antv",
            "template": "sequence-steps-simple",
            "source": "infographic sequence-steps-simple",
        }
    ]
    return data


def test_v2_migration_preserves_order_content_and_revision(tmp_path):
    old = sample_document().model_dump()
    old["version"] = 1
    for page in old["slides"]:
        for key in ("groups", "connections", "reference", "infographics", "image_asset_id"):
            page.pop(key)
    old["slides"].append({"id": "empty", "background": "#FFFFFF", "notes": "", "elements": []})
    with sqlite3.connect(tmp_path / "scene.db") as connection:
        connection.execute("CREATE TABLE presentation_projects(document JSON, revision INTEGER)")
        connection.execute("INSERT INTO presentation_projects VALUES (?, 12)", (json.dumps(old),))
        connection.executescript(SQL)
        first = connection.execute("SELECT document,revision FROM presentation_projects").fetchone()
        connection.executescript(SQL)
        assert (
            connection.execute("SELECT document,revision FROM presentation_projects").fetchone()
            == first
        )
    expected = PresentationDocument.model_validate(old).model_dump()
    expected["version"] = 2  # Historical 0096 SQL is immutable; 0101 upgrades to v3.
    # 0096 predates optional image archives, which are materialized by 0097.
    for source, page in zip(old["slides"], expected["slides"], strict=True):
        page.pop("image_asset_id")
        for key in (
            "animations",
            "transition",
            "background_style",
            "section",
            "notes_rich",
            "annotations",
            "page_type",
            "title",
            "chapter_id",
            "template_hidden",
            "toc_offset",
            "layout_source",
        ):
            if key not in source:
                page.pop(key)
    assert json.loads(first[0]) == expected
    assert first[1] == 12


@pytest.mark.parametrize(
    "problem", ["missing", "cycle", "duplicate-member", "duplicate-id", "self-edge", "missing-info"]
)
def test_scene_contract_rejects_invalid_references(problem):
    data = scene_document()
    page = data["slides"][0]
    if problem == "missing":
        page["connections"][0]["target_id"] = "missing"
    if problem == "cycle":
        page["groups"][0]["parent_id"] = "child"
    if problem == "duplicate-member":
        page["groups"][0]["element_ids"].append("node-a")
    if problem == "duplicate-id":
        page["connections"][0]["id"] = "node-a"
    if problem == "self-edge":
        page["connections"][0]["target_id"] = "node-a"
    if problem == "missing-info":
        page["infographics"][0]["group_id"] = "absent"
    with pytest.raises(ValidationError):
        PresentationDocument.model_validate(data)


def test_native_scene_export_contains_groups_routed_paths_and_editable_text(tmp_path):
    data = scene_document()
    # Nested native groups require contiguous members in the page's paint order.
    items = data["slides"][0]["elements"]
    data["slides"][0]["elements"] = [items[1], items[0], items[2]]
    data["slides"][0]["reference"] = {"asset_id": "not-exported"}
    target = tmp_path / "native.pptx"
    write_pptx(PresentationDocument.model_validate(data), {}, target)
    ns = {
        "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    }
    with ZipFile(target) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
        assert not any("not-exported" in name for name in archive.namelist())
    assert len(root.findall(".//p:grpSp", ns)) == 2
    assert root.find(".//p:cxnSp", ns) is None
    assert root.find(".//p:grpSp/p:sp/p:spPr/a:custGeom", ns) is not None
    assert "内容" in [node.text for node in root.findall(".//a:t", ns)]
    assert len(root.findall(".//p:pic", ns)) == 0


@pytest.mark.parametrize("kind", ["triangle", "diamond", "arrow", "star", "callout"])
def test_custom_nodes_export_explicit_bound_ports(tmp_path, kind):
    data = scene_document()
    data["slides"][0]["elements"][0].update(kind=kind, rotation=30, flip_x=True)
    data["slides"][0]["connections"][0]["waypoints"] = []
    target = tmp_path / "ports.pptx"
    write_pptx(PresentationDocument.model_validate(data), {}, target)
    ns = {
        "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    }
    with ZipFile(target) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
    assert len(root.findall(".//p:sp/p:spPr/a:custGeom/a:cxnLst/a:cxn", ns)) == 4
    assert root.find(".//a:stCxn", ns).get("idx") == "1"


@pytest.mark.asyncio
async def test_scene_batch_duplicate_remaps_all_ids_and_cascades_removal():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/presentation-workshop/projects",
            json={"title": "native scene", "document": scene_document()},
        )
        assert created.status_code == 200, created.text
        project = created.json()
        url = f"/v1/presentation-workshop/projects/{project['id']}"
        body = {
            "expected_revision": 0,
            "request_id": "duplicate-scene",
            "operations": [
                {
                    "entity": "slide",
                    "action": "duplicate",
                    "id": "slide-one",
                    "value": {"id": "slide-copy"},
                }
            ],
        }
        result = await client.post(url + "/operations", json=body)
        assert result.status_code == 200, result.text
        assert (await client.post(url + "/operations", json=body)).json() == result.json()
        copy_page = next(p for p in result.json()["document"]["slides"] if p["id"] == "slide-copy")
        assert set(copy_page["groups"][0]["element_ids"]).issubset(
            {e["id"] for e in copy_page["elements"]}
        )
        assert copy_page["connections"][0]["source_id"] in {e["id"] for e in copy_page["elements"]}
        deletion = {
            "expected_revision": 1,
            "request_id": "remove-node",
            "operations": [
                {"entity": "element", "parent_id": "slide-one", "action": "remove", "id": "node-a"}
            ],
        }
        deleted = await client.post(url + "/operations", json=deletion)
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["document"]["slides"][0]["connections"] == []
        invalid = copy.deepcopy(deletion)
        invalid.update(expected_revision=2, request_id="invalid-edge")
        invalid["operations"] = [
            {
                "entity": "connection",
                "parent_id": "slide-one",
                "action": "insert",
                "id": "bad-edge",
                "value": {"source_id": "node-a", "target_id": "node-b"},
            }
        ]
        assert (await client.post(url + "/operations", json=invalid)).status_code == 422
        assert (await client.get(url)).json()["revision"] == 2


@pytest.mark.asyncio
async def test_atomic_fragment_replacement_and_reference_validation():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post(
                "/v1/presentation-workshop/projects",
                json={"title": "fragment", "document": scene_document()},
            )
        ).json()
        url = f"/v1/presentation-workshop/projects/{project['id']}"
        fragment = scene_document()["slides"][0]
        fragment["id"] = "root"
        fragment["elements"][0]["x"] = 180
        body = {
            "expected_revision": 0,
            "request_id": "replace",
            "operations": [
                {
                    "entity": "fragment",
                    "action": "update",
                    "id": "root",
                    "parent_id": "slide-one",
                    "fragment": fragment,
                }
            ],
        }
        changed = await client.post(url + "/operations", json=body)
        assert changed.status_code == 200, changed.text
        assert changed.json()["document"]["slides"][0]["elements"][0]["x"] == 180
        assert (await client.post(url + "/operations", json=body)).json() == changed.json()
        missing_reference = changed.json()["document"]
        missing_reference["slides"][0]["reference"] = {"asset_id": "other-workspace-or-missing"}
        invalid = await client.put(
            url, json={"title": "fragment", "document": missing_reference, "expected_revision": 1}
        )
        assert invalid.status_code == 404
        assert (await client.get(url)).json()["revision"] == 1


@pytest.mark.real_auth
@pytest.mark.asyncio
async def test_reference_images_enforce_workspace_and_deletion_protection():
    import io
    from contextlib import aclosing

    from PIL import Image

    from test_workspace_governance import client_account

    owner, *_ = await client_account()
    other, *_ = await client_account()
    async with aclosing(owner), aclosing(other):
        buffer = io.BytesIO()
        Image.new("RGB", (12, 12), "white").save(buffer, "PNG")
        upload = await owner.post(
            "/v1/files", files={"upload": ("reference.png", buffer.getvalue(), "image/png")}
        )
        assert upload.status_code == 200, upload.text
        asset = upload.json()
        data = scene_document()
        data["slides"][0]["reference"] = {"asset_id": asset["id"]}
        body = {"title": "private reference", "document": data}
        assert (
            await owner.post("/v1/presentation-workshop/projects", json=body)
        ).status_code == 200
        assert (
            await other.post("/v1/presentation-workshop/projects", json=body)
        ).status_code == 404
        assert (
            await owner.delete(
                f"/v1/files/{asset['id']}", params={"expected_revision": asset["revision"]}
            )
        ).status_code == 409

"""Canvas lifecycle through public APIs and isolated test database fixtures."""

import copy
import io
import json
import sys
import zipfile
from pathlib import Path
from xml.etree.ElementTree import fromstring

import httpx
import pytest
from PIL import Image
from tests.test_account_system import create_test_account, login_and_change_password, unsafe_headers
from tests.test_thought_workshop import note_body
from tests.thought_helpers import create_note

from app.apps.thought_workshop.canvas_export import canvas_svg, wrapped_lines
from app.apps.thought_workshop.schemas.document import (
    document_text,
    file_ids,
    safe_link,
    validate_document,
)
from app.main import app

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sdk/python/src"))

from future_props_lab import AsyncClient  # noqa: E402
from future_props_lab.canvas_example import thought_canvas_example  # noqa: E402

ROOT = "/v1/thought-workshop"


def scene(asset_id=None):
    result = {
        "sceneVersion": 1,
        "title": "系统信息图",
        "elements": [
            {
                "id": "a",
                "kind": "rounded",
                "x": 0,
                "y": 0,
                "width": 160,
                "height": 80,
                "text": "请求入口",
                "fill": "#effaf8",
                "stroke": "#365f62",
            },
            {
                "id": "b",
                "kind": "icon",
                "icon": "database",
                "x": 240,
                "y": 0,
                "width": 160,
                "height": 80,
                "text": "持久化",
                "fill": "#ffffff",
                "stroke": "#365f62",
            },
        ],
        "edges": [
            {
                "id": "e",
                "source": "a",
                "target": "b",
                "label": "版本检查",
                "arrow": True,
                "style": "step",
            }
        ],
    }
    if asset_id:
        result["elements"].append(
            {
                "id": "pic",
                "kind": "image",
                "assetId": asset_id,
                "x": 80,
                "y": 140,
                "width": 240,
                "height": 160,
                "text": "说明图片",
                "fill": "#ffffff",
                "stroke": "#365f62",
            }
        )
    return result


def document(value):
    return {"type": "doc", "content": [{"type": "canvas", "attrs": {"scene": value}}]}


def png():
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), "blue").save(buffer, "PNG")
    return buffer.getvalue()


@pytest.mark.parametrize(
    "url,allowed",
    [
        ("/apps/thought-workshop/official-knowledge-bases/technical-principles", True),
        (
            "/apps/thought-workshop/official-knowledge-bases/technical-principles/documents/overview",
            True,
        ),
        ("https://example.com/guide", True),
        ("/apps/thought-workshop/knowledge-bases/private", False),
        ("//example.com/guide", False),
        ("/apps/thought-workshop/official-knowledge-bases/../private", False),
        ("javascript:alert(1)", False),
    ],
)
def test_official_source_links_allow_only_registered_root_relative_shape(url, allowed):
    assert safe_link(url) is allowed


@pytest.mark.asyncio
async def test_markdown_conversion_retains_existing_size_boundary():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        response = await c.post(ROOT + "/markdown/convert", json={"markdown": "x" * 200001})
        assert response.status_code == 422


async def upload(client, headers=None):
    response = await client.post(
        ROOT + "/images", headers=headers, files={"upload": ("diagram.png", png(), "image/png")}
    )
    assert response.status_code == 200, response.text
    return response.json()["asset_id"]


def test_canvas_projection_and_inert_svg_geometry():
    value = scene("managed-image")
    value["title"] = '<script>alert("title")</script>'
    value["elements"][0]["text"] = '<img onerror="alert(1)">'
    value["elements"].append(
        {
            "id": "frame",
            "kind": "frame",
            "x": -20,
            "y": -20,
            "width": 480,
            "height": 360,
            "text": "分区",
            "fill": "#eeeeee",
            "stroke": "#223344",
        }
    )
    value["elements"][0]["parentId"] = "frame"
    doc = validate_document(document(value))
    assert file_ids(doc) == {"managed-image"}
    assert "版本检查" in document_text(doc) and "说明图片" in document_text(doc)
    rendered = canvas_svg(value, {"managed-image": "assets/managed-image.png"})
    svg = fromstring(rendered)
    ns = {"s": "http://www.w3.org/2000/svg"}
    assert svg.attrib["viewBox"] == "-44 -44 528 408"
    assert svg.find("s:title", ns).text == value["title"]
    assert len(svg.findall(".//s:image", ns)) == 1
    assert svg.find(".//s:image", ns).attrib["href"] == "assets/managed-image.png"
    assert not svg.findall(".//s:script", ns) and not svg.findall(".//s:foreignObject", ns)
    assert "<script>" not in rendered and "onerror=" not in " ".join(svg.attrib)
    assert 'stroke-dasharray="6 4"' in rendered
    assert 'd="M160,40.0 H200.0 V40.0 H240"' in rendered
    assert value["elements"][0]["x"] == 0  # Parent membership does not double offset coordinates.


def test_canvas_text_uses_shared_width_contrast_and_visible_line_centering():
    assert wrapped_lines("ABC中D\n\n😀E", 55) == ["ABC", "中D", "", "😀E"]
    assert wrapped_lines("中文A", 20) == ["中", "文", "A"]
    value = scene()
    element = value["elements"][0]
    element.update(text="第一行\n第二行\n第三行\n第四行", width=160, height=60, fill="#111111")
    svg = fromstring(canvas_svg(value, {}))
    ns = {"s": "http://www.w3.org/2000/svg"}
    text = svg.find("s:g/s:text", ns)
    assert text.attrib["fill"] == "#ffffff"
    assert [node.text for node in text] == ["第一行", "第二行"]
    assert [float(node.attrib["y"]) for node in text] == [25, 45]
    element["kind"] = "frame"
    svg = fromstring(canvas_svg(value, {}))
    assert svg.find("s:g/s:text", ns).attrib["fill"] == "#20383d"


@pytest.mark.asyncio
async def test_invalid_canvas_requests_are_422_and_do_not_create_notes():
    mutations = [
        lambda s: s.update(sceneVersion=True),
        lambda s: s.update(sceneVersion=3),
        lambda s: s.update(elements={}),
        lambda s: s.update(html="<script>"),
        lambda s: s["elements"][0].update(x=10**500),
        lambda s: s["elements"][0].update(width=False),
        lambda s: s["elements"][0].update(fill="url(javascript:alert(1))"),
        lambda s: s["elements"][0].update(fill="#１２３４５６"),
        lambda s: s["elements"][0].update(kind={}),
        lambda s: s["elements"][0].update(icon=[]),
        lambda s: s["elements"][0].update(parentId="missing"),
        lambda s: s["elements"][0].update(parentId=""),
        lambda s: s["elements"][0].update(parentId="b"),
        lambda s: s["elements"][0].update(kind="image", assetId=""),
        lambda s: s["elements"][0].update(assetId="forbidden"),
        lambda s: s["elements"][1].update(id="a"),
        lambda s: s["edges"][0].update(source=[]),
        lambda s: s["edges"][0].update(id="a"),
        lambda s: s["edges"][0].update(target="a"),
        lambda s: s["edges"][0].update(arrow=1),
        lambda s: s["edges"][0].update(style={}),
    ]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        project = (await c.post(ROOT + "/knowledge-bases", json={"title": "输入验证"})).json()
        for mutate in mutations:
            invalid = scene()
            mutate(invalid)
            result = await c.post(
                ROOT + "/notes",
                json={
                    "knowledge_base_id": project["id"],
                    "expected_knowledge_revision": project["revision"],
                    "document": document(invalid),
                },
            )
            assert result.status_code == 422, result.text
        notes = (await c.get(ROOT + "/notes", params={"knowledge_base_id": project["id"]})).json()
        assert notes["total"] == 0


@pytest.mark.asyncio
async def test_canvas_save_search_history_cas_and_backup_remap():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        image_id = await upload(c)
        first_scene = scene(image_id)
        created = await create_note(
            c, json={"title": "画板历史", "document": document(first_scene)}
        )
        assert created.status_code == 200, created.text
        note = created.json()
        path = ROOT + "/notes/" + note["id"]
        initial_history = (await c.get(path + "/history")).json()["items"][0]["id"]
        search = (
            await c.get(
                ROOT + "/notes",
                params={"knowledge_base_id": note["knowledge_base_id"], "query": "版本检查"},
            )
        ).json()
        assert note["id"] in [item["id"] for item in search["items"]]
        edited = scene()
        edited["elements"][0]["x"] = 100
        changed = await c.put(
            path, json={**note_body(note), "expected_revision": 0, "document": document(edited)}
        )
        assert changed.status_code == 200, changed.text
        note = changed.json()
        assert (
            await c.put(path, json={**note_body(note), "expected_revision": 0})
        ).status_code == 409
        assert (await c.get(path)).json()["document"] == document(edited)
        assert (
            await c.delete("/v1/files/" + image_id, params={"expected_revision": 0})
        ).status_code == 409
        backup = await c.get(
            ROOT + "/backup", params={"knowledge_base_id": note["knowledge_base_id"]}
        )
        assert backup.status_code == 200, backup.text
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            assert archive.read("assets/" + image_id) == png()
        imported = await c.post(
            ROOT + "/imports", files={"upload": ("backup.zip", backup.content, "application/zip")}
        )
        assert imported.status_code == 200, imported.text
        imported_path = ROOT + "/notes/" + imported.json()["note_ids"][0]
        history = (await c.get(imported_path + "/history")).json()["items"]
        imported_note = (await c.get(imported_path)).json()
        restored = await c.post(
            imported_path + "/history/" + history[-1]["id"] + "/restore",
            json={"expected_revision": imported_note["revision"]},
        )
        assert restored.status_code == 200, restored.text
        restored_scene = restored.json()["document"]["content"][0]["attrs"]["scene"]
        new_image = restored_scene["elements"][2]["assetId"]
        assert new_image != image_id
        assert (await c.get("/v1/files/" + new_image + "/download")).content == png()
        expected = copy.deepcopy(first_scene)
        expected["elements"][2]["assetId"] = new_image
        assert restored_scene == expected
        # Restore the source note independently; neither source nor history was rewritten on import.
        original = await c.post(
            path + "/history/" + initial_history + "/restore",
            json={"expected_revision": note["revision"]},
        )
        assert original.status_code == 200, original.text
        assert original.json()["document"] == document(first_scene)


@pytest.mark.asyncio
async def test_canvas_markdown_roundtrip_and_portable_html_images():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        image_id = await upload(c)
        value = scene(image_id)
        value["elements"][0]["text"] = "源码 ``` 与 <script>"
        rich = document(value)
        rich["content"].append({"type": "mermaid", "attrs": {"source": "flowchart LR\nA-->B"}})
        created = await create_note(c, json={"title": "可移植图文", "document": rich})
        assert created.status_code == 200, created.text
        note = created.json()
        for format in ("md", "html"):
            response = await c.get(
                ROOT + "/notes/" + note["id"] + "/export",
                params={"expected_revision": 0, "format": format},
            )
            assert response.status_code == 200, response.text
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                content = archive.read("document." + format).decode()
                image_path = "assets/" + image_id + ".png"
                assert archive.read(image_path) == png()
            if format == "md":
                assert "```fpl-canvas" in content and "\\u0060" in content
                imported = await c.post(
                    ROOT + "/markdown/convert",
                    json={"markdown": content, "assets": {image_path: image_id}},
                )
                assert imported.status_code == 200, imported.text
                canvas = next(
                    n for n in imported.json()["document"]["content"] if n["type"] == "canvas"
                )
                assert canvas["attrs"]["scene"] == value
                missing = await c.post(ROOT + "/markdown/convert", json={"markdown": content})
                assert missing.status_code == 422
            else:
                assert '<figure class="fpl-canvas"><svg' in content
                assert f'href="{image_path}"' in content
                assert "<script>" not in content and "foreignObject" not in content
                assert "https://" not in content and "<script " not in content
                # Server export intentionally retains Mermaid source; Web export renders SVG.
                assert 'class="language-mermaid"' in content and "flowchart LR" in content


@pytest.mark.asyncio
async def test_canvas_rejects_non_image_resource_in_note_and_markdown():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        result = await c.post(
            ROOT + "/attachments", files={"upload": ("readme.txt", b"not an image", "text/plain")}
        )
        asset_id = result.json()["asset_id"]
        saved = await create_note(c, json={"document": document(scene(asset_id))})
        assert saved.status_code == 422, saved.text
        converted = await c.post(
            ROOT + "/markdown/convert",
            json={
                "markdown": "```fpl-canvas\n" + json.dumps(scene("assets/picture")) + "\n```",
                "assets": {"assets/picture": asset_id},
            },
        )
        assert converted.status_code == 422, converted.text


@pytest.mark.real_auth
@pytest.mark.asyncio
async def test_canvas_images_cannot_cross_workspace_or_bypass_resource_lookup():
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as a,
        httpx.AsyncClient(transport=transport, base_url="http://test") as b,
    ):
        await login_and_change_password(a, *(await create_test_account()))
        await login_and_change_password(b, *(await create_test_account()))
        asset_id = await upload(a, unsafe_headers(a))
        attempted = await create_note(
            b, headers=unsafe_headers(b), json={"document": document(scene(asset_id))}
        )
        assert attempted.status_code == 404, attempted.text
        markdown = "```fpl-canvas\n" + json.dumps(scene("picture.png")) + "\n```"
        attempted = await b.post(
            ROOT + "/markdown/convert",
            headers=unsafe_headers(b),
            json={"markdown": markdown, "assets": {"picture.png": asset_id}},
        )
        assert attempted.status_code == 404, attempted.text
        for fake_id in ("missing", "https://example.invalid/image.png", "../image.png"):
            invalid = await create_note(
                a, headers=unsafe_headers(a), json={"document": document(scene(fake_id))}
            )
            assert invalid.status_code == 404, invalid.text


@pytest.mark.asyncio
async def test_sdk_canvas_recipe_uses_public_api_and_exports_editable_data(tmp_path):
    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(base_url="http://test", transport=transport) as sdk:
        library = await sdk.thought.create_knowledge_base(body={"title": "SDK 画板"})
        output = tmp_path / "canvas.md"
        note_id, note = await thought_canvas_example(sdk, library.id, output)
        assert note.document["content"][0]["attrs"]["scene"]["sceneVersion"] == 1
        saved = await sdk.thought.get_note(note_id=note_id)
        assert saved.document == note.document
        assert "```fpl-canvas" in output.read_text() and "校验后写入" in output.read_text()


@pytest.mark.asyncio
async def test_canvas_backup_rejects_invalid_scene_and_missing_image_atomically():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        asset_id = await upload(c)
        note = (await create_note(c, json={"document": document(scene(asset_id))})).json()
        backup = await c.get(
            ROOT + "/backup", params={"knowledge_base_id": note["knowledge_base_id"]}
        )
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            payload = json.loads(archive.read("manifest.json"))
            resources = {
                name: archive.read(name) for name in archive.namelist() if name != "manifest.json"
            }
        before = (await c.get(ROOT + "/knowledge-bases")).json()
        for mode in ("invalid-scene", "missing-image"):
            invalid = copy.deepcopy(payload)
            if mode == "invalid-scene":
                source = next(item for item in invalid["notes"] if item["id"] == note["id"])
                source["document"]["content"][0]["attrs"]["scene"]["sceneVersion"] = 999
            else:
                invalid["assets"] = []
            data = io.BytesIO()
            with zipfile.ZipFile(data, "w") as archive:
                archive.writestr("manifest.json", json.dumps(invalid))
                for name, content in resources.items():
                    archive.writestr(name, content)
            result = await c.post(
                ROOT + "/imports",
                files={"upload": ("invalid.zip", data.getvalue(), "application/zip")},
            )
            assert result.status_code == 422, result.text
            assert (await c.get(ROOT + "/knowledge-bases")).json() == before

from __future__ import annotations

import asyncio
import copy
import io
import json
import stat
import threading
import zipfile
from pathlib import Path

import httpx
import pytest
from PIL import Image
from pydantic import ValidationError

from app.apps.live2d_workshop.cubism import inspect_cubism_package
from app.apps.live2d_workshop.models import Live2DExport
from app.apps.live2d_workshop.packages import read_package
from app.apps.live2d_workshop.projects import Live2DInvalid, Live2DNotFound, Live2DProjectsStore
from app.apps.live2d_workshop.runner import Live2DExportRunner
from app.capabilities.media_rendering.live2d.document import CharacterDocument
from app.capabilities.media_rendering.live2d.evaluate import evaluate, parameter_values
from app.capabilities.media_rendering.live2d.render import render_frame
from app.main import app
from app.runtime.db import SessionLocal


def test_v1_document_upgrades_and_state_references_are_checked():
    old = {"schemaVersion": 1, "width": 128, "height": 128}
    upgraded = CharacterDocument.model_validate(old)
    assert upgraded.schema_version == 3
    assert set(upgraded.cameras) == {"avatar", "stage"}
    assert upgraded.state_bindings == {}
    assert upgraded.cubism_parameter_ids == {}
    with pytest.raises(ValidationError, match="状态绑定的动作不存在"):
        CharacterDocument.model_validate(
            {**old, "stateBindings": {"thinking": {"motionId": "missing"}}}
        )
    with pytest.raises(ValidationError):
        CharacterDocument.model_validate({**old, "stateBindings": {"unknown": {}}})
    with pytest.raises(ValidationError, match="Cubism 参数映射无效"):
        CharacterDocument.model_validate({**old, "cubismParameterIds": {"missing": "ParamAngleX"}})
    with pytest.raises(ValidationError, match="Cubism 参数 ID 重复"):
        CharacterDocument.model_validate(
            {
                **old,
                "cubismParameterIds": {"ParamAngleX": "ParamAngleY"},
                "parameters": [
                    {"id": "ParamAngleX", "name": "X", "minimum": -1, "maximum": 1, "default": 0},
                    {"id": "ParamAngleY", "name": "Y", "minimum": -1, "maximum": 1, "default": 0},
                ],
            }
        )


FIXTURE = json.loads((Path(__file__).parent / "fixtures/live2d-evaluation.json").read_text())


def png(color=(220, 50, 30, 128)) -> bytes:
    data = io.BytesIO()
    Image.new("RGBA", (16, 16), color).save(data, format="PNG")
    return data.getvalue()


def cubism_zip(*, missing_texture: bool = False, legacy: bool = False) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr(
            "role/role.model3.json",
            json.dumps(
                {
                    "Version": 3,
                    "FileReferences": {
                        "Moc": "role.moc3",
                        "Textures": ["textures/atlas.png"],
                        "Motions": {"Idle": [{"File": "motions/idle.motion3.json"}]},
                        "Expressions": [{"Name": "Smile", "File": "expressions/smile.exp3.json"}],
                    },
                }
            ),
        )
        archive.writestr("role/role.moc3", b"MOC3" + b"\0" * 12)
        if not missing_texture:
            archive.writestr("role/textures/atlas.png", png())
        archive.writestr("role/motions/idle.motion3.json", b"{}")
        archive.writestr("role/expressions/smile.exp3.json", b"{}")
        if legacy:
            archive.writestr("role/old.mtn", b"old")
    return out.getvalue()


def test_cubism_preflight_validates_references_and_legacy_files():
    metadata = inspect_cubism_package(cubism_zip())
    assert metadata["modelPath"] == "role/role.model3.json"
    assert metadata["motions"]["Idle"] == ["role/motions/idle.motion3.json"]
    with pytest.raises(Live2DInvalid, match="缺失引用"):
        inspect_cubism_package(cubism_zip(missing_texture=True))
    with pytest.raises(Live2DInvalid, match="Cubism 2"):
        inspect_cubism_package(cubism_zip(legacy=True))


def test_cubism_preflight_rejects_unsafe_zip_paths():
    for unsafe in ("../escape.png", "/absolute.png", "folder\\escape.png"):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            archive.writestr(unsafe, png())
            archive.writestr("role.model3.json", b"{}")
        with pytest.raises(Live2DInvalid, match="不安全"):
            inspect_cubism_package(out.getvalue())


@pytest.mark.asyncio
async def test_cubism_attachment_cas_v4_roundtrip_and_conversion_copy():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        source = (
            await client.post("/v1/live2d-workshop/projects", json={"title": "源角色"})
        ).json()
        base = f"/v1/live2d-workshop/projects/{source['id']}"
        runtime = cubism_zip()
        preflight = await client.post(
            f"{base}/cubism/preflight", files={"file": ("role.zip", runtime)}
        )
        assert preflight.status_code == 200, preflight.text
        missing_revision = await client.put(f"{base}/cubism", files={"file": ("role.zip", runtime)})
        assert missing_revision.status_code == 422
        attached = await client.put(
            f"{base}/cubism", data={"expectedRevision": "0"}, files={"file": ("role.zip", runtime)}
        )
        assert attached.status_code == 200, attached.text
        assert attached.json()["revision"] == 1
        assert attached.json()["stateBindings"] == {"idle": {"motion": "Idle:0"}}
        assert (await client.get(f"{base}/cubism/package")).content == runtime
        assert (
            await client.put(
                f"{base}/cubism",
                data={"expectedRevision": "0"},
                files={"file": ("role.zip", runtime)},
            )
        ).status_code == 409
        mapping = {
            state: {"motion": "Idle:0", "expression": "Smile"}
            for state in ("idle", "listening", "thinking", "tool", "success", "error", "paused")
        }
        invalid_binding = await client.put(
            f"{base}/cubism/bindings",
            json={"expectedRevision": 1, "stateBindings": {"idle": {"motion": "Missing:0"}}},
        )
        assert invalid_binding.status_code == 422
        saved = await client.put(
            f"{base}/cubism/bindings",
            json={
                "expectedRevision": 1,
                "stateBindings": mapping,
            },
        )
        assert saved.status_code == 200, saved.text
        exported = await client.get(f"{base}/package")
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            assert json.loads(archive.read("manifest.json"))["version"] == 4
            assert archive.read("cubism/source.zip") == runtime
        imported = await client.post(
            "/v1/live2d-workshop/projects/import",
            files={
                "file": ("role.fpllive2d", exported.content, "application/zip"),
            },
        )
        assert imported.status_code == 200, imported.text
        copied = await client.get(f"/v1/live2d-workshop/projects/{imported.json()['id']}/cubism")
        assert copied.json()["stateBindings"] == mapping
        native = io.BytesIO()
        with zipfile.ZipFile(native, "w") as archive:
            archive.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "format": "fpllive2d",
                        "version": 3,
                        "title": "转换副本",
                        "document": {"schemaVersion": 3, "width": 1200, "height": 1600},
                    }
                ),
            )
        converted = await client.post(
            f"{base}/cubism/convert",
            data={
                "expectedRevision": "2",
                "stateBindings": json.dumps(mapping),
            },
            files={
                "file": ("converted.fpllive2d", native.getvalue(), "application/zip"),
                "source": ("runtime.zip", runtime, "application/zip"),
            },
        )
        assert converted.status_code == 200, converted.text
        assert converted.json()["id"] != source["id"]
        assert (await client.get(base)).json()["revision"] == 2
        assert (
            await client.get(f"/v1/live2d-workshop/projects/{converted.json()['id']}/cubism")
        ).status_code == 200


def test_parameter_evaluator_matches_shared_geometry_and_alpha(tmp_path):
    doc = CharacterDocument.model_validate(FIXTURE["document"])
    values = parameter_values(doc, 15, "nod", "smile-exp")
    assert values == FIXTURE["values"]
    parts, _ = evaluate(doc, values)
    for actual, expected in zip(parts[0]["worldVertices"], FIXTURE["vertices"], strict=True):
        assert actual == pytest.approx(expected)
    path = tmp_path / "texture.png"
    path.write_bytes(png())
    image = render_frame(doc, {"texture": path})
    assert image.getpixel((0, 0))[3] == 0
    assert image.getpixel((15, 15))[3] == 128  # triangle seam must not double alpha
    assert image.getpixel((18, 15))[3] == 128
    moved = render_frame(
        doc, {"texture": path}, frame=15, motion_id="nod", expression_id="smile-exp"
    )
    assert moved.tobytes() != image.tobytes()


@pytest.mark.parametrize(
    "mutation", ["cycle", "mask", "index", "topology", "parameter", "nan", "keyform_field"]
)
def test_document_rejects_broken_references(mutation):
    data = copy.deepcopy(FIXTURE["document"])
    if mutation == "cycle":
        data["deformers"][0]["parentId"] = "head"
    if mutation == "mask":
        data["parts"][0]["maskId"] = "face"
    if mutation == "index":
        data["parts"][0]["triangles"][0] = 100
    if mutation == "topology":
        data["parameters"][1]["bindings"][0]["keys"][0]["points"].pop()
    if mutation == "parameter":
        data["motions"][0]["tracks"][0]["parameterId"] = "missing"
    if mutation == "keyform_field":
        for key in data["parameters"][0]["bindings"][0]["keys"]:
            key["opacity"] = 0.5
    if mutation == "nan":
        data["parts"][0]["vertices"][0]["x"] = float("nan")
    with pytest.raises(ValidationError):
        CharacterDocument.model_validate(data)


@pytest.mark.parametrize("mutation", ["cycle", "missing", "sum", "too_many", "camera"])
def test_v3_rejects_invalid_skeleton_and_camera(mutation):
    data = copy.deepcopy(FIXTURE["document"])
    data["schemaVersion"] = 3
    data["bones"] = [
        {"id": "root", "name": "根", "x": 10, "y": 10},
        {"id": "child", "name": "子", "parentId": "root", "x": 15, "y": 15},
    ]
    data["parts"][0]["parentId"] = None
    data["parts"][0]["skinWeights"] = [
        [{"boneId": "root", "weight": 1}] for _ in data["parts"][0]["vertices"]
    ]
    data["cameras"] = {
        "avatar": {"x": 0, "y": 0, "width": 64, "height": 64},
        "stage": {"x": 0, "y": 0, "width": 128, "height": 128},
    }
    if mutation == "cycle":
        data["bones"][0]["parentId"] = "child"
    elif mutation == "missing":
        data["parts"][0]["skinWeights"][0][0]["boneId"] = "absent"
    elif mutation == "sum":
        data["parts"][0]["skinWeights"][0][0]["weight"] = 0.5
    elif mutation == "too_many":
        data["parts"][0]["skinWeights"][0] = [{"boneId": f"b{i}", "weight": 0.2} for i in range(5)]
    elif mutation == "camera":
        data["cameras"]["avatar"]["x"] = 100
    with pytest.raises(ValidationError):
        CharacterDocument.model_validate(data)


@pytest.mark.parametrize(
    "filename,mode", [("../private", 0), ("/tmp/private", 0), ("link", stat.S_IFLNK), ("a\\b", 0)]
)
def test_packages_reject_paths_and_symlinks(filename, mode):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        info = zipfile.ZipInfo(filename)
        info.external_attr = mode << 16
        archive.writestr(info, b"outside")
    with pytest.raises(Live2DInvalid):
        read_package(buffer.getvalue())


def test_v1_package_imports_as_v3_with_original_pixels():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format": "fpllive2d",
                    "version": 1,
                    "title": "旧角色",
                    "document": FIXTURE["document"],
                }
            ),
        )
        archive.writestr("assets/texture.png", png())
    title, document, assets = read_package(buffer.getvalue())
    assert title == "旧角色"
    assert document.schema_version == 3
    assert document.state_bindings == {}
    with Image.open(io.BytesIO(assets["texture"][0])) as image:
        assert image.getpixel((0, 0)) == (220, 50, 30, 128)


@pytest.mark.asyncio
async def test_reimport_retire_asset_checks_revision_and_document_references():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/live2d-workshop/projects", json={"title": "重导入"})
        ).json()
        base = f"/v1/live2d-workshop/projects/{project['id']}"
        first = (
            await client.post(f"{base}/assets", files={"file": ("first.png", png(), "image/png")})
        ).json()
        doc = copy.deepcopy(FIXTURE["document"])
        doc["parts"][0]["assetId"] = first["id"]
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 0, "document": doc})
        ).status_code == 200
        assert (
            await client.delete(f"{base}/assets/{first['id']}", params={"expectedRevision": 1})
        ).status_code == 422
        second = (
            await client.post(
                f"{base}/assets", files={"file": ("second.png", png((1, 2, 3, 255)), "image/png")}
            )
        ).json()
        assert (
            await client.delete(f"{base}/assets/{second['id']}", params={"expectedRevision": 0})
        ).status_code == 409
        doc["parts"][0]["assetId"] = second["id"]
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 1, "document": doc})
        ).status_code == 200
        retired = await client.delete(
            f"{base}/assets/{first['id']}", params={"expectedRevision": 2}
        )
        assert retired.status_code == 200
        assert retired.json()["revision"] == 3
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 2, "document": doc})
        ).status_code == 409
        assert (await client.get(f"{base}/assets/{first['id']}/file")).status_code == 404
        assert (await client.get(f"{base}/assets/{second['id']}/file")).status_code == 200


@pytest.mark.asyncio
async def test_full_character_workflow_cas_packages_exports_and_isolation(monkeypatch):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post("/v1/live2d-workshop/projects", json={"title": "角色测试"})
        assert created.status_code == 200, created.text
        project_id = created.json()["id"]
        base = f"/v1/live2d-workshop/projects/{project_id}"
        upload = await client.post(
            f"{base}/assets", files={"file": ("face.png", png(), "image/png")}
        )
        assert upload.status_code == 200, upload.text
        asset_id = upload.json()["id"]
        doc = copy.deepcopy(FIXTURE["document"])
        doc["parts"][0]["assetId"] = asset_id
        doc["stateBindings"] = {"thinking": {"motionId": "nod", "expressionId": "smile-exp"}}
        doc["cubismParameterIds"] = {"smile": "ParamSmile"}
        saved = await client.put(f"{base}/document", json={"expectedRevision": 0, "document": doc})
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 1
        assert saved.json()["document"]["schemaVersion"] == 3
        stale = await client.put(f"{base}/document", json={"expectedRevision": 0, "document": doc})
        assert stale.status_code == 409
        assert stale.json()["current"]["document"]["parts"][0]["assetId"] == asset_id
        missing_revision = await client.put(f"{base}/document", json={"document": doc})
        assert missing_revision.status_code == 422
        async with SessionLocal() as session:
            with pytest.raises(Live2DNotFound):
                await Live2DProjectsStore(session, "another-workspace").get(project_id)
        other = (
            await client.post("/v1/live2d-workshop/projects", json={"title": "另一项目"})
        ).json()["id"]
        assert (
            await client.put(
                f"/v1/live2d-workshop/projects/{other}/document",
                json={"expectedRevision": 0, "document": doc},
            )
        ).status_code == 422
        package = await client.get(f"{base}/package")
        assert package.status_code == 200, package.text
        with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
            assert json.loads(archive.read("manifest.json"))["version"] == 3
        imported = await client.post(
            "/v1/live2d-workshop/projects/import",
            files={"file": ("role.fpllive2d", package.content, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        imported_doc = (
            await client.get(f"/v1/live2d-workshop/projects/{imported.json()['id']}/document")
        ).json()["document"]
        assert [(p["id"], p["name"]) for p in imported_doc["parameters"]] == [
            (p["id"], p["name"]) for p in doc["parameters"]
        ]
        assert imported_doc["stateBindings"]["thinking"]["motionId"] == "nod"
        assert imported_doc["stateBindings"]["thinking"]["expressionId"] == "smile-exp"
        assert imported_doc["cubismParameterIds"] == doc["cubismParameterIds"]
        assert imported_doc["parts"][0]["assetId"] != asset_id
        assert (await client.get(f"{base}/thumbnail")).headers["content-type"] == "image/png"
        preview = await client.get(
            f"{base}/preview",
            params={
                "expectedRevision": 1,
                "width": 64,
                "height": 32,
                "cropX": 0,
                "cropY": 0,
                "cropWidth": 16,
                "cropHeight": 16,
            },
        )
        assert preview.status_code == 200, preview.text
        with Image.open(io.BytesIO(preview.content)) as rendered:
            assert rendered.size == (64, 32)
        assert (
            await client.get(f"{base}/preview", params={"expectedRevision": 0})
        ).status_code == 409
        assert (await client.get(f"{base}/preview", params={"cropX": 0})).status_code == 422
        assert (
            await client.get(f"{base}/preview", params={"motionId": "missing"})
        ).status_code == 422
        assert (
            await client.get(
                f"{base}/preview",
                params={"cropX": 4000, "cropY": 0, "cropWidth": 20, "cropHeight": 20},
            )
        ).status_code == 422
        request = {
            "expectedRevision": 1,
            "requestId": "character-export-test",
            "combinations": [{"expressionId": "smile-exp", "motionId": "nod"}, {"motionId": "nod"}],
            "width": 32,
            "height": 32,
            "fps": 30,
            "startFrame": 0,
            "endFrame": 2,
        }
        check = await client.post(f"{base}/exports/preflight", json=request)
        assert check.json()["ready"], check.text
        result = await client.post(f"{base}/exports", json=request)
        assert result.status_code == 200, result.text
        task_id = result.json()["id"]
        assert (await client.post(f"{base}/exports", json=request)).json()["id"] == task_id
        changed = await client.post(f"{base}/exports", json={**request, "width": 64})
        assert changed.status_code == 422
        await Live2DExportRunner().process_once()
        result = (await client.get(f"{base}/exports/{task_id}")).json()
        assert result["settings"]["expectedRevision"] == 1
        assert result["settings"]["combinations"] == [
            {"expressionId": None, **pair} for pair in request["combinations"]
        ]
        assert result["status"] == "completed", result
        archive_response = await client.get(result["download"])
        with zipfile.ZipFile(io.BytesIO(archive_response.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert len(manifest["combinations"]) == 2
            assert len([n for n in archive.namelist() if n.endswith(".png")]) == 4
            assert len({n.split("/")[0] for n in archive.namelist() if n.endswith(".png")}) == 2
        started, release = threading.Event(), threading.Event()

        def blocked_render(*args, **kwargs):
            started.set()
            assert release.wait(10)
            return render_frame(*args, **kwargs)

        monkeypatch.setattr("app.apps.live2d_workshop.runner.render_frame", blocked_render)
        running = (
            await client.post(f"{base}/exports", json={**request, "requestId": "running-cancel"})
        ).json()
        running_task = asyncio.create_task(Live2DExportRunner().process_once())
        assert await asyncio.to_thread(started.wait, 10)
        cancelled = await client.post(f"{base}/exports/{running['id']}/cancel")
        assert cancelled.status_code == 200
        release.set()
        await running_task
        assert (await client.get(f"{base}/exports/{running['id']}")).json()["status"] == "cancelled"
        assert (await client.get(f"{base}/exports/{running['id']}/download")).status_code == 404

        def broken_render(*_args, **_kwargs):
            raise ValueError("素材缺失：test")

        monkeypatch.setattr("app.apps.live2d_workshop.runner.render_frame", broken_render)
        broken = (
            await client.post(f"{base}/exports", json={**request, "requestId": "render-failure"})
        ).json()
        await Live2DExportRunner().process_once()
        assert (await client.get(f"{base}/exports/{broken['id']}")).json()["status"] == "failed"
        monkeypatch.setattr("app.apps.live2d_workshop.runner.render_frame", render_frame)
        second = (
            await client.post(
                f"{base}/exports", json={**request, "requestId": "character-cancel-test"}
            )
        ).json()
        assert (await client.post(f"{base}/exports/{second['id']}/cancel")).json()[
            "status"
        ] == "cancelled"
        async with SessionLocal() as session:
            task = await session.get(Live2DExport, second["id"])
            task.status = "running"
            await session.commit()
        await Live2DExportRunner().recover()
        assert (await client.get(f"{base}/exports/{second['id']}")).json()["status"] == "failed"
        assert (await client.delete(base, params={"expectedRevision": 0})).status_code == 409
        assert (await client.delete(base, params={"expectedRevision": 1})).status_code == 200
        assert (await client.get(base)).status_code == 404


def test_mask_uses_alpha_of_hidden_parts_and_preserves_draw_order(tmp_path):
    data = copy.deepcopy(FIXTURE["document"])
    data["parameters"] = []
    data["motions"] = []
    data["expressions"] = []
    mask = copy.deepcopy(data["parts"][0])
    mask.update(id="mask", assetId="mask-texture", visible=False, opacity=0.5)
    data["parts"][0].update(maskId="mask", opacity=1)
    data["parts"].append(mask)
    texture = tmp_path / "face.png"
    texture.write_bytes(png())
    mask_file = tmp_path / "mask.png"
    Image.new("RGBA", (16, 16), (255, 255, 255, 255)).save(mask_file)
    doc = CharacterDocument.model_validate(data)
    result = render_frame(doc, {"texture": texture, "mask-texture": mask_file})
    assert result.getpixel((15, 15))[3] == 64
    data["parts"][1].update(visible=True, opacity=1, maskId=None, order=5)
    result = render_frame(
        CharacterDocument.model_validate(data), {"texture": texture, "mask-texture": mask_file}
    )
    assert result.getpixel((15, 15)) == (255, 255, 255, 255)

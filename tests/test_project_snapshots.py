from __future__ import annotations

import hashlib
import io
import json
import stat
import zipfile
from pathlib import Path

import httpx
import pytest
from sqlalchemy import delete

import studio.host.project_files.folders as folder_module
from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.layout.website_upgrade import reconcile_snapshot_imports
from studio.apps.galgame_workshop.storage.models import (
    GalgameWorkshopProject,
)
from studio.apps.video_editor.storage.models import (
    VideoEditorProject,
)
from studio.apps.visual_workshop.storage.models import (
    VisualWorkshopProject,
)
from studio.assembly.http_dependencies import SessionDep, require_studio_auth
from studio.assembly.website.models import bind_owner
from studio.config.settings import get_settings
from studio.contracts.identity.principal import StudioPrincipal
from studio.host.project_files.folders import open_project_folder
from website_test_support import SessionLocal, app


async def _reset_projects() -> None:
    from tests.account_fixtures import clear_private_projects

    await clear_private_projects()
    async with SessionLocal() as session:
        await session.execute(delete(VideoEditorProject))
        await session.execute(
            delete(GalgameWorkshopProject).where(
                GalgameWorkshopProject.owner_user_id == "test-user"
            )
        )
        await session.execute(
            delete(VisualWorkshopProject).where(VisualWorkshopProject.owner_user_id == "test-user")
        )
        await session.commit()


def _zip_members(payload: bytes) -> tuple[dict, dict, set[str]]:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        project = json.loads(archive.read("project.json"))
        names = set(archive.namelist())
    return manifest, project, names


async def _import(client: httpx.AsyncClient, endpoint: str, payload: bytes) -> httpx.Response:
    return await client.post(
        endpoint,
        files={"file": ("project-snapshot.zip", payload, "application/zip")},
    )


@pytest.mark.asyncio
async def test_visual_snapshot_round_trip_turns_shared_assets_into_private_copies() -> None:
    await _reset_projects()
    content = b"\x89PNG\r\n\x1a\nportable-visual-asset"
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "Portable Visual", "kind": "canvas"},
            )
        ).json()
        library_asset = (
            await client.post(
                "/v1/files",
                files={"upload": ("reference.png", content, "image/png")},
            )
        ).json()
        reference = await client.post(
            f"/v1/visual-workshop/projects/{project['id']}/asset-references",
            json={"asset_id": library_asset["id"]},
        )
        assert reference.status_code == 200, reference.text
        canvas = await client.put(
            f"/v1/visual-workshop/projects/{project['id']}/canvas",
            json={
                "expected_revision": 0,
                "nodes": [
                    {
                        "id": "image-1",
                        "kind": "image",
                        "title": "Reference",
                        "position": {"x": 10, "y": 20},
                        "asset_id": library_asset["id"],
                    }
                ],
            },
        )
        assert canvas.status_code == 200, canvas.text

        exported = await client.get(f"/v1/visual-workshop/projects/{project['id']}/snapshot")
        assert exported.status_code == 200, exported.text
        assert exported.headers["content-type"].startswith("application/zip")
        manifest, bundle, names = _zip_members(exported.content)
        assert manifest["application_id"] == "visual-workshop"
        assert set(names) == {
            "manifest.json",
            "project.json",
            manifest["assets"][0]["path"],
        }
        assert "owner_user_id" not in json.dumps(bundle)

        imported = await _import(
            client, "/v1/visual-workshop/projects/snapshot-imports", exported.content
        )
        assert imported.status_code == 200, imported.text
        copy = imported.json()["project"]
        assert copy["id"] != project["id"]
        assert copy["title"] == "Portable Visual（副本）"
        assert copy["revision"] == 0
        copied_canvas = (
            await client.get(f"/v1/visual-workshop/projects/{copy['id']}/canvas")
        ).json()
        copied_asset_id = copied_canvas["nodes"][0]["asset_id"]
        assert copied_asset_id != library_asset["id"]
        assert copied_canvas["nodes"][0]["generation_task_id"] is None
        copied_assets = (await client.get("/v1/files", params={"project_id": copy["id"]})).json()[
            "items"
        ]
        assert [item["id"] for item in copied_assets] == [copied_asset_id]
        assert copied_assets[0]["is_reference"] is False
        assert (await client.get(f"/v1/files/{copied_asset_id}/content")).content == content

        repeated = await _import(
            client, "/v1/visual-workshop/projects/snapshot-imports", exported.content
        )
        assert repeated.status_code == 200
        assert repeated.json()["project"]["id"] not in {project["id"], copy["id"]}


@pytest.mark.asyncio
async def test_galgame_and_video_snapshots_round_trip_assets_and_editable_documents() -> None:
    await _reset_projects()
    galgame_content = b"\x89PNG\r\n\x1a\ncharacter-asset"
    video_content = b"\x89PNG\r\n\x1a\nvideo-frame-asset"
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        galgame = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "Portable Story"})
        ).json()
        galgame_asset = await client.post(
            f"/v1/galgame-workshop/projects/{galgame['id']}/assets",
            files={"upload": ("hero.png", galgame_content, "image/png")},
        )
        assert galgame_asset.status_code == 200, galgame_asset.text
        story_before = (
            await client.get(f"/v1/galgame-workshop/projects/{galgame['id']}/story")
        ).json()["document"]
        galgame_zip = await client.get(f"/v1/galgame-workshop/projects/{galgame['id']}/snapshot")
        assert galgame_zip.status_code == 200, galgame_zip.text
        _, galgame_bundle, galgame_names = _zip_members(galgame_zip.content)
        assert galgame_bundle["story"] == story_before
        assert not any("export" in name or "derived" in name for name in galgame_names)
        galgame_import = await _import(
            client,
            "/v1/galgame-workshop/projects/snapshot-imports",
            galgame_zip.content,
        )
        assert galgame_import.status_code == 200, galgame_import.text
        galgame_copy = galgame_import.json()["project"]
        copied_story = (
            await client.get(f"/v1/galgame-workshop/projects/{galgame_copy['id']}/story")
        ).json()["document"]
        assert copied_story == story_before
        copied_galgame_assets = (
            await client.get(f"/v1/galgame-workshop/projects/{galgame_copy['id']}/assets")
        ).json()["items"]
        assert len(copied_galgame_assets) == 1
        assert copied_galgame_assets[0]["id"] != galgame_asset.json()["id"]

        video = (
            await client.post("/v1/video-editor/projects", json={"title": "Portable Edit"})
        ).json()
        uploaded = await client.post(
            f"/v1/video-editor/projects/{video['id']}/assets",
            files={"upload": ("frame.png", video_content, "image/png")},
        )
        assert uploaded.status_code == 200, uploaded.text
        organized = await client.post(
            f"/v1/video-editor/projects/{video['id']}/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": "snapshot-organized-assets",
                "operations": [
                    {
                        "type": "setAssetOrganization",
                        "organization": {
                            "folders": [
                                {
                                    "id": "folder-frames",
                                    "name": "Frames",
                                    "assetIds": [uploaded.json()["id"]],
                                }
                            ],
                            "rootAssetIds": [],
                        },
                    }
                ],
            },
        )
        assert organized.status_code == 200, organized.text
        timeline_before = (
            await client.get(f"/v1/video-editor/projects/{video['id']}/timeline")
        ).json()["document"]
        video_zip = await client.get(f"/v1/video-editor/projects/{video['id']}/snapshot")
        assert video_zip.status_code == 200, video_zip.text
        _, video_bundle, video_names = _zip_members(video_zip.content)
        assert video_bundle["timeline"] == timeline_before
        assert not any("proxy" in name or "waveform" in name for name in video_names)
        video_import = await _import(
            client, "/v1/video-editor/projects/snapshot-imports", video_zip.content
        )
        assert video_import.status_code == 200, video_import.text
        video_copy = video_import.json()["project"]
        copied_timeline = (
            await client.get(f"/v1/video-editor/projects/{video_copy['id']}/timeline")
        ).json()["document"]
        copied_video_assets = (
            await client.get(f"/v1/video-editor/projects/{video_copy['id']}/assets")
        ).json()["items"]
        assert len(copied_video_assets) == 1
        assert copied_video_assets[0]["id"] != uploaded.json()["id"]
        assert copied_timeline == {
            **timeline_before,
            "assetOrganization": {
                "folders": [
                    {
                        "id": "folder-frames",
                        "name": "Frames",
                        "assetIds": [copied_video_assets[0]["id"]],
                    }
                ],
                "rootAssetIds": [],
            },
        }
        assert copied_video_assets[0]["processingStatus"] == "queued"
        assert (
            await client.get(f"/v1/files/{copied_video_assets[0]['id']}/content")
        ).content == video_content


def _rewrite_zip(payload: bytes, mutate) -> bytes:
    source = zipfile.ZipFile(io.BytesIO(payload))
    output_buffer = io.BytesIO()
    with source, zipfile.ZipFile(output_buffer, "w") as output:
        for item in source.infolist():
            data = source.read(item)
            replacement = mutate(item, data)
            if replacement is not None:
                output.writestr(item, replacement)
    return output_buffer.getvalue()


def _with_missing_visual_model(payload: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(payload)) as source:
        files = {item.filename: source.read(item) for item in source.infolist()}
    project = json.loads(files["project.json"])
    project["canvas"]["nodes"] = [
        {
            "id": "generated-image",
            "kind": "image",
            "title": "Generated",
            "position": {"x": 0, "y": 0},
            "generation_task_id": "old-task",
            "generation_draft": {
                "model_id": "source-model",
                "prompt": "keep this prompt",
            },
        }
    ]
    project["model_references"] = {
        "source-model": {"provider_kind": "missing-provider", "model_slug": "missing-model"}
    }
    project_bytes = json.dumps(project, ensure_ascii=False, separators=(",", ":")).encode()
    manifest = json.loads(files["manifest.json"])
    manifest["project_byte_size"] = len(project_bytes)
    manifest["project_sha256"] = hashlib.sha256(project_bytes).hexdigest()
    files["project.json"] = project_bytes
    files["manifest.json"] = json.dumps(
        manifest, ensure_ascii=False, separators=(",", ":")
    ).encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return output.getvalue()


@pytest.mark.asyncio
async def test_snapshot_import_rejects_wrong_app_tampering_and_unsafe_members() -> None:
    await _reset_projects()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "Validation", "kind": "image"},
            )
        ).json()
        exported = (
            await client.get(f"/v1/visual-workshop/projects/{project['id']}/snapshot")
        ).content

        wrong_app = await _import(
            client, "/v1/galgame-workshop/projects/snapshot-imports", exported
        )
        assert wrong_app.status_code == 422
        assert wrong_app.json()["code"] == "snapshot_application_mismatch"

        future = _rewrite_zip(
            exported,
            lambda item, data: (
                json.dumps(
                    {**json.loads(data), "format_version": 2},
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode()
                if item.filename == "manifest.json"
                else data
            ),
        )
        future_version = await _import(
            client, "/v1/visual-workshop/projects/snapshot-imports", future
        )
        assert future_version.status_code == 422

        tampered = _rewrite_zip(
            exported,
            lambda item, data: data + b" " if item.filename == "project.json" else data,
        )
        invalid_hash = await _import(
            client, "/v1/visual-workshop/projects/snapshot-imports", tampered
        )
        assert invalid_hash.status_code == 422

        missing_model = await _import(
            client,
            "/v1/visual-workshop/projects/snapshot-imports",
            _with_missing_visual_model(exported),
        )
        assert missing_model.status_code == 200, missing_model.text
        assert missing_model.json()["warnings"] == [
            {
                "code": "model_binding_unavailable",
                "field": "canvas.nodes[0].generation_draft.model_id",
                "message": "原生成模型在当前账号中不可用，请重新选择。",
            }
        ]
        copied_canvas = (
            await client.get(
                f"/v1/visual-workshop/projects/{missing_model.json()['project']['id']}/canvas"
            )
        ).json()
        assert copied_canvas["nodes"][0]["generation_task_id"] is None
        assert copied_canvas["nodes"][0]["generation_draft"] == {
            "model_id": None,
            "prompt": "keep this prompt",
            "prompt_versions": [{"id": "v1", "name": "v1", "prompt": "keep this prompt"}],
            "active_prompt_version_id": "v1",
            "size": "1024x1024",
            "seed": None,
            "image_count": 1,
            "grid_output": None,
            "grid_size": None,
            "reference_asset_id": None,
            "reference_asset_ids": [],
            "prompt_reference_names": {},
        }

        unsafe_buffer = io.BytesIO()
        with (
            zipfile.ZipFile(io.BytesIO(exported)) as source,
            zipfile.ZipFile(unsafe_buffer, "w") as output,
        ):
            for item in source.infolist():
                output.writestr(item, source.read(item))
            output.writestr("../escape.txt", b"blocked")
        unsafe = await _import(
            client, "/v1/visual-workshop/projects/snapshot-imports", unsafe_buffer.getvalue()
        )
        assert unsafe.status_code == 422

        symlink_buffer = io.BytesIO()
        with (
            zipfile.ZipFile(io.BytesIO(exported)) as source,
            zipfile.ZipFile(symlink_buffer, "w") as output,
        ):
            for item in source.infolist():
                output.writestr(item, source.read(item))
            link = zipfile.ZipInfo("assets/link")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            output.writestr(link, b"/tmp/escape")
        symlink = await _import(
            client, "/v1/visual-workshop/projects/snapshot-imports", symlink_buffer.getvalue()
        )
        assert symlink.status_code == 422

        duplicate_buffer = io.BytesIO()
        with (
            zipfile.ZipFile(io.BytesIO(exported)) as source,
            zipfile.ZipFile(duplicate_buffer, "w") as output,
        ):
            for item in source.infolist():
                output.writestr(item, source.read(item))
            output.writestr("MANIFEST.JSON", source.read("manifest.json"))
        duplicate = await _import(
            client, "/v1/visual-workshop/projects/snapshot-imports", duplicate_buffer.getvalue()
        )
        assert duplicate.status_code == 422


@pytest.mark.asyncio
async def test_open_folder_uses_server_derived_paths_and_requires_browser_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _reset_projects()
    calls: list[list[str]] = []
    monkeypatch.setattr(folder_module.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(
        folder_module.subprocess,
        "Popen",
        lambda command, **_kwargs: calls.append(command),
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        endpoints: list[tuple[str, str, str]] = []
        visual = (
            await client.post("/v1/visual-workshop/projects", json={"title": "V", "kind": "canvas"})
        ).json()
        endpoints.append(
            (
                "visual-workshop",
                visual["id"],
                f"/v1/visual-workshop/projects/{visual['id']}/open-folder",
            )
        )
        galgame = (await client.post("/v1/galgame-workshop/projects", json={"title": "G"})).json()
        endpoints.append(
            (
                "galgame-workshop",
                galgame["id"],
                f"/v1/galgame-workshop/projects/{galgame['id']}/open-folder",
            )
        )
        video = (await client.post("/v1/video-editor/projects", json={"title": "E"})).json()
        endpoints.append(
            (
                "video-editor",
                video["id"],
                f"/v1/video-editor/projects/{video['id']}/open-folder",
            )
        )
        storage = AssetStorage(get_settings())
        for application_id, project_id, endpoint in endpoints:
            response = await client.post(endpoint)
            assert response.status_code == 200, response.text
            assert calls[-1] == [
                "open",
                str(storage.project_root(application_id, project_id, owner_user_id="test-user")),
            ]

        async def api_key_principal(session: SessionDep) -> StudioPrincipal:
            bind_owner(session, "test-user")
            return StudioPrincipal(
                platform_role="admin",
                user_id="api-key",
                must_change_password=False,
                auth_kind="management_api_key",
                scopes=frozenset({"studio:read", "studio:write"}),
            )

        app.dependency_overrides[require_studio_auth] = api_key_principal
        try:
            denied = await client.post(endpoints[0][2])
            assert denied.status_code == 403
            assert denied.json()["code"] == "browser_session_required"
        finally:
            app.dependency_overrides.pop(require_studio_auth, None)


@pytest.mark.asyncio
async def test_open_folder_platform_command_mapping(monkeypatch: pytest.MonkeyPatch) -> None:
    root = Path(get_settings().runtime_path) / "folder-command-test"
    root.mkdir(parents=True, exist_ok=True)

    class StorageStub:
        def project_root(self, *_args, **_kwargs) -> Path:
            return root

    calls: list[list[str]] = []
    monkeypatch.setattr(
        folder_module.subprocess,
        "Popen",
        lambda command, **_kwargs: calls.append(command),
    )
    for system, executable in (("Darwin", "open"), ("Windows", "explorer"), ("Linux", "xdg-open")):
        monkeypatch.setattr(folder_module.platform, "system", lambda value=system: value)
        await open_project_folder(
            StorageStub(), "video-editor", "project", owner_user_id="test-user"
        )
        assert calls[-1] == [executable, str(root)]


@pytest.mark.asyncio
async def test_open_library_folder_uses_library_root_and_requires_browser_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(folder_module.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(
        folder_module.subprocess,
        "Popen",
        lambda command, **_kwargs: calls.append(command),
    )
    storage = AssetStorage(get_settings())
    library_root = storage.target_root(
        visual_project_id=None,
        galgame_project_id=None,
        video_editor_project_id=None,
        owner_user_id="test-user",
    )
    library_root.mkdir(parents=True, exist_ok=True)
    missing = Path(get_settings().runtime_path) / "missing-library-assets"

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        opened = await client.post("/v1/file-storage/open-folder")
        assert opened.status_code == 200, opened.text
        assert opened.json() == {"opened": True}
        assert calls[-1] == ["open", str(library_root)]

        monkeypatch.setattr(
            AssetStorage,
            "target_root",
            lambda _self, **_kwargs: missing,
        )
        absent = await client.post("/v1/file-storage/open-folder")
        assert absent.status_code == 409
        assert absent.json()["code"] == "library_folder_missing"

        async def api_key_principal(session: SessionDep) -> StudioPrincipal:
            bind_owner(session, "test-user")
            return StudioPrincipal(
                platform_role="admin",
                user_id="api-key",
                must_change_password=False,
                auth_kind="management_api_key",
                scopes=frozenset({"studio:read", "studio:write"}),
            )

        app.dependency_overrides[require_studio_auth] = api_key_principal
        try:
            denied = await client.post("/v1/file-storage/open-folder")
            assert denied.status_code == 403
            assert denied.json()["code"] == "browser_session_required"
        finally:
            app.dependency_overrides.pop(require_studio_auth, None)


@pytest.mark.asyncio
async def test_snapshot_endpoints_treat_other_workspace_projects_as_missing() -> None:
    await _reset_projects()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        visual = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "V", "kind": "canvas"},
            )
        ).json()
        galgame = (await client.post("/v1/galgame-workshop/projects", json={"title": "G"})).json()
        video = (await client.post("/v1/video-editor/projects", json={"title": "E"})).json()

        async def other_workspace(session: SessionDep) -> StudioPrincipal:
            bind_owner(session, "other-workspace")
            return StudioPrincipal(
                platform_role="admin",
                user_id="other-user",
                must_change_password=False,
                auth_kind="session",
                scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
                session_id="other-session",
            )

        app.dependency_overrides[require_studio_auth] = other_workspace
        try:
            endpoints = (
                f"/v1/visual-workshop/projects/{visual['id']}/snapshot",
                f"/v1/galgame-workshop/projects/{galgame['id']}/snapshot",
                f"/v1/video-editor/projects/{video['id']}/snapshot",
            )
            for endpoint in endpoints:
                response = await client.get(endpoint)
                assert response.status_code == 404, response.text
        finally:
            app.dependency_overrides.pop(require_studio_auth, None)


@pytest.mark.asyncio
async def test_startup_reconciles_interrupted_snapshot_project_roots() -> None:
    await _reset_projects()
    storage = AssetStorage(get_settings())
    orphan = storage.project_root("visual-workshop", "orphan-import", owner_user_id="test-user")
    (orphan / "assets").mkdir(parents=True)
    (orphan / ".snapshot-importing").write_text("1", encoding="ascii")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "Committed", "kind": "canvas"},
            )
        ).json()
    committed = storage.project_root("visual-workshop", project["id"], owner_user_id="test-user")
    marker = committed / ".snapshot-importing"
    marker.write_text("1", encoding="ascii")
    async with SessionLocal() as session:
        await reconcile_snapshot_imports(session, storage)
    assert not orphan.exists()
    assert committed.is_dir()
    assert not marker.exists()

"""Account-scoped navigation persists through the independent Tools service."""

import asyncio
import json
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from studio.apps.tools.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.tools.application import create_app
from studio.runtime.database.migrations import apply
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    PASSWORD,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize

ROOT = Path(__file__).resolve().parents[2]
STATE = "/v1/tool-navigation/state"
TOOL = "/v1/tool-navigation/tools/json-formatter"


async def test_tools_state_uses_its_own_account_database(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    root = tmp_path / "tools"
    apply(root / "service.db", "tools", MIGRATIONS)

    def application():
        return create_app(state_root=root, catalog=CATALOG, public_key=case.key.public_key())

    app = application()
    published = json.loads((ROOT / "web/src/generated/openapi.json").read_text())["paths"]
    template = "/v1/tool-navigation/tools/{tool_id}"
    for path in (STATE, template, template + "/use"):
        assert app.openapi()["paths"][path] == published[path]

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://tools") as api,
    ):
        assert (await api.get(STATE)).status_code == 401
        assert (await api.get("/ready")).status_code == 503
        read = await authorize(case, "tools", "GET", STATE)
        write = await authorize(case, "tools", "PATCH", TOOL)
        use = await authorize(case, "tools", "POST", TOOL + "/use")
        assert (await api.get(STATE, headers=read)).json() == {"items": []}
        results = await asyncio.gather(
            api.patch(TOOL, headers=write, json={"is_favorite": True}),
            *(api.post(TOOL + "/use", headers=use) for _ in range(6)),
        )
        assert all(result.status_code == 200 for result in results)
        assert sorted(result.json()["use_count"] for result in results[1:]) == list(range(1, 7))

    restarted = application()
    async with (
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted), base_url="http://tools"
        ) as api,
    ):
        state = await api.get(STATE, headers=await authorize(case, "tools", "GET", STATE))
        item = state.json()["items"][0]
        assert item["use_count"] == 6 and item["is_favorite"] is True

        switched = await case.browser.post(
            "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
        )
        assert switched.status_code == 200
        case.csrf = case.browser.cookies["fpl_csrf"]
        other = await authorize(case, "tools", "GET", STATE)
        assert (await api.get(STATE, headers=other)).json() == {"items": []}


async def test_tools_library_reveal_is_local_and_replays_a_lost_worker_acknowledgement(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    from studio.apps.tools import host as tools_host
    from studio.contracts.identity.claims import HEADER, Actor, issue_context, verify_context
    from studio.contracts.tools.tools_native import OPEN_PATH, VIDEO_DEPS_PATH, ToolsNativeOptions
    from studio.contracts.tools.video_download import BinaryStatus, VideoDownloadDepsOut
    from studio.host.project_files.tools_worker import ToolsWorker
    from studio.host.transport import NativeTransport

    case = scenario
    root = tmp_path / "tools"
    assets = tmp_path / "owned-assets"
    assets.mkdir()
    apply(root / "service.db", "tools", MIGRATIONS)
    options = ToolsNativeOptions(
        identity_credential="identity-" * 8,
        ingress="ingress-" * 8,
        workers={"isolated-worker": "worker-" * 8},
    )
    case.identity.state.identity_options["service_credentials"]["tools"] = (
        options.identity_credential
    )
    app = create_app(
        state_root=root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        native_options=options,
        identity_transport=case.mesh,
    )
    published = json.loads((ROOT / "web/src/generated/openapi.json").read_text())["paths"]
    assert app.openapi()["paths"][OPEN_PATH] == published[OPEN_PATH]
    assert app.openapi()["paths"][VIDEO_DEPS_PATH] == published[VIDEO_DEPS_PATH]
    calls = []
    lost = False
    real_transport = httpx.ASGITransport(app=app)

    async def native_request(request):
        nonlocal lost
        # Simulate the headers added on the authenticated loopback ingress only.
        request.url = request.url.copy_with(path=request.url.path.removeprefix("/tools"))
        for name in list(request.headers):
            if name.startswith("x-fpl-"):
                del request.headers[name]
        request.headers["X-Fpl-Native-Ingress"] = options.ingress
        if request.url.path.endswith("/authorize"):
            assert json.loads(request.content)["lease"]["payload"] == {}
        response = await real_transport.handle_async_request(request)
        if not lost and request.url.path.endswith("/receipt") and response.status_code == 200:
            lost = True
            await response.aclose()
            raise httpx.ReadError("synthetic lost Tools acknowledgement", request=request)
        return response

    def dependencies():
        return VideoDownloadDepsOut(
            ready=True,
            yt_dlp=BinaryStatus(name="yt-dlp", ok=True, path="/fixture/yt-dlp", version="test"),
            ffmpeg=BinaryStatus(name="ffmpeg", ok=True, path="/fixture/ffmpeg", version="test"),
        )

    def reveal(path, owner):
        calls.append((path, owner))
        return {"opened": True}

    transport = NativeTransport(
        service="tools",
        base_url="http://127.0.0.1:19090/tools",
        credential=options.workers["isolated-worker"],
        transport=httpx.MockTransport(native_request),
    )
    worker = ToolsWorker(transport, assets, tmp_path / "worker", reveal=reveal)
    public = issue_context(
        Actor(
            case.viewer,
            "admin",
            "session",
            ("studio:read", "studio:private_read", "studio:write"),
            session_id="test",
            local=False,
        ),
        service="tools",
        method="POST",
        path=OPEN_PATH,
        private_key=case.key,
        key_id="test",
    )
    async with (
        transport.client,
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=real_transport, base_url="http://tools") as api,
    ):
        denied = await api.post(OPEN_PATH, headers={HEADER: public})
        assert denied.status_code == 403 and denied.json()["code"] == "local_access_required"
        spoof = await api.post(
            "/_native/v1/claim",
            headers={
                "Origin": "http://browser",
                "X-Fpl-Native-Ingress": options.ingress,
                "Authorization": "Bearer " + options.workers["isolated-worker"],
            },
            json={"wait_seconds": 0},
        )
        assert spoof.status_code == 403
        headers = await authorize(case, "tools", "POST", OPEN_PATH)
        request = asyncio.create_task(api.post(OPEN_PATH, headers=headers))
        try:
            await worker.poll_once()
        except httpx.ReadError:
            assert lost
        response = await request
        assert response.status_code == 200, response.text
        assert len(list(worker.receipts.pending())) == 1
        restarted = ToolsWorker(
            transport, assets, tmp_path / "worker", reveal=reveal, dependencies=dependencies
        )
        await restarted.poll_once()
        assert list(restarted.receipts.pending()) == []
        assert calls == [(assets.resolve(), case.viewer)]
        monkeypatch.setattr(tools_host, "WINDOW_SECONDS", 0.1)
        expired = await api.post(OPEN_PATH, headers=headers)
        assert expired.status_code == 503 and expired.json()["code"] == "folder_open_unavailable"
        unclaimed = await transport.post("claim", {"wait_seconds": 0})
        assert unclaimed == {"lease": None}
        assert calls == [(assets.resolve(), case.viewer)]
        local_headers = await authorize(case, "tools", "GET", VIDEO_DEPS_PATH)
        local_actor = verify_context(
            local_headers[HEADER],
            service="tools",
            method="GET",
            path=VIDEO_DEPS_PATH,
            public_key=case.key.public_key(),
        )
        public_probe = issue_context(
            replace(local_actor, local=False),
            service="tools",
            method="GET",
            path=VIDEO_DEPS_PATH,
            private_key=case.key,
            key_id="test",
        )
        for headers, expected_path in (
            (local_headers, "/fixture/yt-dlp"),
            ({HEADER: public_probe}, None),
        ):
            pending = asyncio.create_task(api.get(VIDEO_DEPS_PATH, headers=headers))
            await restarted.poll_once()
            probed = await pending
            assert probed.status_code == 200 and probed.json()["ready"], probed.text
            assert probed.json()["yt_dlp"]["path"] == expected_path
        assert calls == [(assets.resolve(), case.viewer)]


def test_tools_worker_uses_only_the_owned_library_path(tmp_path):
    from uuid import uuid4

    from studio.host.project_files.tools_worker import reveal_library

    owner = str(uuid4())
    path = tmp_path / "accounts" / owner / "library" / "assets"
    path.mkdir(parents=True)
    calls = []
    launch = lambda args, **_: calls.append(args)  # noqa: E731
    assert reveal_library(tmp_path, owner, launch=launch) == {"opened": True}
    assert calls == [["/usr/bin/open", str(path)]]
    path.rmdir()
    path.symlink_to(tmp_path, target_is_directory=True)
    assert reveal_library(tmp_path, owner, launch=launch) == {"error": "library_folder_missing"}
    assert reveal_library(tmp_path, "../foreign", launch=launch) == {
        "error": "library_folder_missing"
    }
    assert len(calls) == 1


def test_tools_native_download_workspace_binds_bytes_without_exposing_paths(tmp_path):
    from uuid import uuid4

    from studio.contracts.tools.video_errors import VideoDownloadError
    from studio.host.project_files.tools_video import VideoWorkspace

    calls = []

    def download(*, url, quality, work_dir, cookies_from_browser):
        calls.append((url, quality, cookies_from_browser))
        (work_dir / "captured.mp4").write_bytes(b"synthetic native video")
        (work_dir / "captured.info.json").write_text('{"title":"Sample video"}')

    workspace = VideoWorkspace(tmp_path, download=download)
    job = uuid4()
    receipt = workspace.execute(
        job,
        {"url": "https://www.bilibili.com/video/BV1xx411c7mD", "quality": "720"},
    )
    assert len(calls) == 1 and calls[0][1:] == ("720", None)
    assert receipt.title == "Sample video" and receipt.filename == "Sample_video.mp4"
    assert "path" not in receipt.model_dump()
    media = workspace.result_path(job, receipt)
    assert media.read_bytes() == b"synthetic native video"
    media.write_bytes(b"changed")
    with pytest.raises(VideoDownloadError, match="持久回执"):
        workspace.result_path(job, receipt)
    workspace.forget(job)
    assert not media.parent.exists()


async def test_tools_download_artifact_commit_checks_digest_and_replays_after_reopen(tmp_path):
    from hashlib import sha256

    from studio.apps.tools.storage.service_models import ToolsDownloadArtifact, ToolsNativeJob
    from studio.apps.tools.video_files import DownloadFiles
    from studio.contracts.tools.tools_video import DOWNLOAD_VIDEO, VideoDownloadResult
    from studio.contracts.tools.video_errors import VideoDownloadError
    from studio.runtime.database.sessions import Database
    from studio.runtime.tasks.native_queue import NativeQueue
    from studio.runtime.time import utc_now

    models = (ToolsNativeJob, ToolsDownloadArtifact)
    apply(tmp_path / "service.db", "tools", MIGRATIONS)
    database = Database("tools", tmp_path, models=models)
    contents = b"verified worker video"
    expected = VideoDownloadResult(
        title="Worker sample",
        filename="sample.mp4",
        mime_type="video/mp4",
        byte_size=len(contents),
        content_sha256=sha256(contents).hexdigest(),
    )

    async def chunks(value):
        yield value[:4]
        yield value[4:]

    try:
        queue = NativeQueue(database, ToolsNativeJob, operations={DOWNLOAD_VIDEO}, clock=utc_now)
        job = await queue.enqueue(
            owner="one",
            operation=DOWNLOAD_VIDEO,
            request_id="request",
            payload={},
        )
        job_id = job["id"]
        files = DownloadFiles(database)
        with pytest.raises(VideoDownloadError, match="摘要"):
            await files.store("one", job_id, expected, chunks(b"x" * len(contents)))
        assert await files.receipt("one", job_id) is None
        with pytest.raises(VideoDownloadError, match="任务不存在"):
            await files.store("two", job_id, expected, chunks(contents))
        assert await files.store("one", job_id, expected, chunks(contents)) == expected
    finally:
        await database.close()

    reopened = Database("tools", tmp_path, models=models)
    try:
        files = DownloadFiles(reopened)
        assert await files.store("one", job_id, expected, chunks(contents)) == expected
        assert files.path(job_id, expected).read_bytes() == contents
        mismatch = expected.model_copy(update={"title": "Changed"})
        with pytest.raises(VideoDownloadError, match="回执冲突"):
            await files.store("one", job_id, mismatch, chunks(contents))
    finally:
        await reopened.close()


async def test_tools_native_video_replays_delivery_and_serves_owned_bytes(
    scenario,  # noqa: F811
    tmp_path,
):
    from sqlalchemy import select

    from studio.apps.asset_library.storage.models import VisualAsset
    from studio.apps.identity.clients.authorization import LiveAuthorization
    from studio.contracts.tools.tools_native import ToolsNativeOptions
    from studio.contracts.tools.tools_video import VIDEO_JOB_PATH
    from studio.contracts.tools.video_download import BinaryStatus, VideoDownloadDepsOut
    from studio.host.project_files.tools_worker import ToolsWorker
    from studio.host.transport import NativeTransport

    case = scenario
    root = tmp_path / "tools"
    assets_root = tmp_path / "owned-assets"
    assets_root.mkdir()
    apply(root / "service.db", "tools", MIGRATIONS)
    options = ToolsNativeOptions(
        identity_credential="identity-" * 8,
        ingress="ingress-" * 8,
        workers={"isolated-worker": "worker-" * 8},
    )
    case.identity.state.identity_options["service_credentials"]["tools"] = (
        options.identity_credential
    )
    assets_live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = assets_live
    app = create_app(
        state_root=root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        native_options=options,
        identity_transport=case.mesh,
    )
    published = json.loads((ROOT / "web/src/generated/openapi.json").read_text())["paths"]
    paths = {
        path: operations
        for path, operations in app.openapi()["paths"].items()
        if path.startswith("/v1/")
    }
    expected = {entry.path for entry in CATALOG.operations if entry.service == "tools"}
    assert set(paths) == expected
    assert paths == {path: published[path] for path in expected}

    artifact = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64
    calls = []
    lost = False
    real_transport = httpx.ASGITransport(app=app)

    async def native_request(request):
        nonlocal lost
        request.url = request.url.copy_with(path=request.url.path.removeprefix("/tools"))
        for name in list(request.headers):
            if name.startswith("x-fpl-"):
                del request.headers[name]
        request.headers["X-Fpl-Native-Ingress"] = options.ingress
        response = await real_transport.handle_async_request(request)
        if not lost and "/download-outputs/" in request.url.path and response.status_code == 200:
            lost = True
            await response.aclose()
            raise httpx.ReadError("synthetic lost output acknowledgement", request=request)
        return response

    def download(*, url, quality, work_dir, cookies_from_browser):
        calls.append((url, quality, cookies_from_browser))
        (work_dir / "native-video.mp4").write_bytes(artifact)

    def dependencies():
        return VideoDownloadDepsOut(
            ready=True,
            yt_dlp=BinaryStatus(name="yt-dlp", ok=True, version="fixture"),
            ffmpeg=BinaryStatus(name="ffmpeg", ok=True, version="fixture"),
        )

    transport = NativeTransport(
        service="tools",
        base_url="http://127.0.0.1:19090/tools",
        credential=options.workers["isolated-worker"],
        transport=httpx.MockTransport(native_request),
    )

    def worker():
        return ToolsWorker(
            transport,
            assets_root,
            tmp_path / "worker",
            dependencies=dependencies,
            downloader=download,
        )

    async with (
        transport.client,
        assets_live.client,
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=real_transport, base_url="http://tools") as api,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=case.assets), base_url="http://assets"
        ) as asset_api,
    ):
        folder_path = "/v1/file-folders"
        folder = await asset_api.post(
            folder_path,
            headers=await authorize(case, "assets", "POST", folder_path),
            json={"scope": "library", "name": "Download fixtures"},
        )
        assert folder.status_code == 200, folder.text
        folder_id = folder.json()["id"]
        payload = {
            "url": "https://www.bilibili.com/video/BV1xx411c7mD",
            "quality": "720",
            "folder_id": folder_id,
        }

        async def submit(active_worker, **options):
            headers = await authorize(case, "tools", "POST", VIDEO_JOB_PATH)
            response_task = asyncio.create_task(
                api.post(VIDEO_JOB_PATH, headers=headers, json={**payload, **options})
            )
            await active_worker.poll_once()
            response = await response_task
            assert response.status_code == 200, response.text
            assert response.json()["status"] == "queued"
            return VIDEO_JOB_PATH + "/" + response.json()["id"]

        initial = worker()
        job = await submit(initial)
        with pytest.raises(httpx.ReadError, match="synthetic lost"):
            await initial.poll_once()
        assert lost and len(calls) == 1
        resumed = worker()
        await resumed.poll_once()
        result = await api.get(job, headers=await authorize(case, "tools", "GET", job))
        assert result.status_code == 200 and result.json()["status"] == "succeeded", result.text
        asset_id = result.json()["asset"]["id"]
        download_path = job + "/file"
        fetched = await api.get(
            download_path, headers=await authorize(case, "tools", "GET", download_path)
        )
        assert fetched.status_code == 200 and fetched.content == artifact
        assert len(calls) == 1

        library_only = await submit(resumed, save_to_disk=False)
        await resumed.poll_once()
        unavailable = library_only + "/file"
        assert (
            await api.get(unavailable, headers=await authorize(case, "tools", "GET", unavailable))
        ).status_code == 404
        assert len(calls) == 2
        async with case.assets.state.database.sessions(
            info={"owner_user_id": case.viewer}
        ) as session:
            saved = list(await session.scalars(select(VisualAsset)))
            assert len(saved) == 2 and asset_id in {row.id for row in saved}
            assert {row.folder_id for row in saved} == {folder_id}

    reopened = create_app(state_root=root, catalog=CATALOG, public_key=case.key.public_key())
    async with (
        reopened.router.lifespan_context(reopened),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=reopened), base_url="http://tools"
        ) as api,
    ):
        saved = await api.get(job, headers=await authorize(case, "tools", "GET", job))
        assert saved.status_code == 200 and saved.json()["asset"]["id"] == asset_id
        fetched = await api.get(
            download_path, headers=await authorize(case, "tools", "GET", download_path)
        )
        assert fetched.content == artifact

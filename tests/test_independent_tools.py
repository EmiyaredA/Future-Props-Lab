"""Account-scoped navigation persists through the independent Tools service."""

import asyncio
import json
from dataclasses import replace
from pathlib import Path

import httpx
from tests.test_community_asset_protocol import CATALOG, PASSWORD, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from fpl_runtime.migrations import apply
from fpl_tools.application import create_app
from fpl_tools.migrations.registry import MIGRATIONS

ROOT = Path(__file__).resolve().parents[1]
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
    from app.tool_navigation.video_download_contracts import BinaryStatus, VideoDownloadDepsOut
    from fpl_host.tools_worker import ToolsWorker
    from fpl_host.transport import NativeTransport
    from fpl_runtime.claims import HEADER, Actor, issue_context, verify_context
    from fpl_runtime.tools_native import OPEN_PATH, VIDEO_DEPS_PATH, ToolsNativeOptions
    from fpl_tools import host as tools_host

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

    from fpl_host.tools_worker import reveal_library

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

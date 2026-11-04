"""A local browser may reveal only its verified Video project directory."""

import asyncio
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import httpx
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from fpl_host.tools_worker import ToolsWorker, reveal_video_project
from fpl_host.transport import NativeTransport
from fpl_runtime.claims import HEADER, issue_context, verify_context
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_runtime.project_reveal import TOOLS_PREFIX
from fpl_runtime.tools_native import ToolsNativeOptions
from fpl_tools.application import create_app as create_tools
from fpl_tools.migrations.registry import MIGRATIONS as TOOLS_MIGRATIONS
from fpl_video.application import PROJECTS
from fpl_video.application import create_app as create_video
from fpl_video.migrations.registry import MIGRATIONS as VIDEO_MIGRATIONS

ROOT = Path(__file__).resolve().parents[1]


async def test_video_reveal_requires_local_owner_and_scoped_worker_receipt(scenario, tmp_path):  # noqa: F811
    case = scenario
    options = ToolsNativeOptions(
        identity_credential="identity-tools-" * 4,
        ingress="native-ingress-" * 4,
        workers={"isolated-worker": "native-worker-" * 4},
    )
    credentials = case.identity.state.identity_options["service_credentials"]
    credentials.update(tools=options.identity_credential, video="identity-video-" * 4)
    tools_root, video_root = tmp_path / "tools", tmp_path / "video"
    apply(tools_root / "service.db", "tools", TOOLS_MIGRATIONS)
    apply(video_root / "service.db", "video", VIDEO_MIGRATIONS)
    assets_identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    case.assets.state.identity = assets_identity
    assets_root = case.assets.state.settings.runtime_path
    tools = create_tools(
        state_root=tools_root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        native_options=options,
        identity_transport=case.mesh,
    )
    video = create_video(
        state_root=video_root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        schema_path=ROOT / "web/src/generated/openapi.json",
        credential=credentials["video"],
        transport=case.mesh,
        run_worker=False,
    )
    case.mesh.apps["tools"] = tools
    calls = []
    tools_api = httpx.ASGITransport(app=tools)
    lost = False

    async def native_request(request):
        nonlocal lost
        request.url = request.url.copy_with(path=request.url.path.removeprefix("/tools"))
        request.headers["X-Fpl-Native-Ingress"] = options.ingress
        response = await tools_api.handle_async_request(request)
        if request.url.path.endswith("/receipt") and response.status_code == 200 and not lost:
            lost = True
            await response.aclose()
            raise httpx.ReadError("isolated lost worker acknowledgement", request=request)
        return response

    def open_project(root, owner, project):
        return reveal_video_project(
            root, owner, project, launch=lambda args, **_: calls.append(args)
        )

    transport = NativeTransport(
        service="tools",
        base_url="http://127.0.0.1:19090/tools",
        credential=options.workers["isolated-worker"],
        transport=httpx.MockTransport(native_request),
    )

    def worker():
        return ToolsWorker(transport, assets_root, tmp_path / "worker", reveal_project=open_project)

    async with (
        transport.client,
        tools.router.lifespan_context(tools),
        video.router.lifespan_context(video),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=video), base_url="http://video") as api,
    ):
        created = await api.post(
            PROJECTS,
            headers=await authorize(case, "video", "POST", PROJECTS),
            json={"title": "Owned native reveal"},
        )
        assert created.status_code == 200, created.text
        project = created.json()["id"]
        path = f"{PROJECTS}/{project}/open-folder"
        headers = await authorize(case, "video", "POST", path)
        actor = verify_context(
            headers[HEADER],
            service="video",
            method="POST",
            path=path,
            public_key=case.key.public_key(),
        )
        assert actor.local

        def signed(**values):
            return {
                HEADER: issue_context(
                    replace(actor, **values),
                    service="video",
                    method="POST",
                    path=path,
                    private_key=case.key,
                    key_id="isolated",
                )
            }

        assert (await api.post(path, headers=signed(local=False))).status_code == 403
        assert (await api.post(path, headers=signed(user_id=case.owner))).status_code == 404
        async with httpx.AsyncClient(transport=tools_api, base_url="http://tools") as private:
            assert (
                await private.post(TOOLS_PREFIX + f"/video-editor/{project}", headers=headers)
            ).status_code == 401
        first = worker()
        opening = asyncio.create_task(api.post(path, headers=headers))
        try:
            await first.poll_once()
        except httpx.ReadError:
            assert lost
        response = await opening
        assert response.status_code == 200, response.text
        assert lost and len(list(first.receipts.pending())) == 1
        restarted = worker()
        await restarted.poll_once()
        assert list(restarted.receipts.pending()) == []
        folder = (
            assets_root
            / "accounts"
            / case.viewer
            / "applications"
            / "video-editor"
            / "projects"
            / project
        )
        assert calls == [["/usr/bin/open", str(folder)]]
        assert {entry.name for entry in folder.iterdir()} == {"assets", "derived", "exports"}

        stray = folder.with_name(str(uuid4()))
        stray.symlink_to(folder, target_is_directory=True)
        assert open_project(assets_root, case.viewer, stray.name) == {
            "error": "project_folder_missing"
        }
        (folder / "assets").rmdir()
        (folder / "assets").symlink_to(tmp_path, target_is_directory=True)
        assert (await api.post(path, headers=headers)).status_code == 409
        assert len(calls) == 1
    await assets_identity.close()

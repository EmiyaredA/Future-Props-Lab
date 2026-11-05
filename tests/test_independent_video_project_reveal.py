"""A local browser may reveal only its verified project directory."""

import asyncio
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import PROJECTS as PROJECT_OWNERS
from tests.test_independent_project_catalog import authorize

from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.tools.storage.migrations.registry import MIGRATIONS as TOOLS_MIGRATIONS
from studio.apps.video_editor.storage.migrations.registry import MIGRATIONS as VIDEO_MIGRATIONS
from studio.assembly.independent.tools.application import create_app as create_tools
from studio.assembly.independent.video_editor.application import create_app as create_video
from studio.contracts.asset_library.reveal import TOOLS_PREFIX
from studio.contracts.identity.claims import HEADER, issue_context, verify_context
from studio.contracts.tools.tools_native import ToolsNativeOptions
from studio.host.project_files.tools_worker import (
    ToolsWorker,
    reveal_video_project,
    reveal_workshop_project,
)
from studio.host.transport import NativeTransport
from studio.runtime.database.migrations import apply

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize(
    "service,application",
    [("video", "video-editor"), ("visual", "visual-workshop"), ("galgame", "galgame-workshop")],
)
async def test_project_reveal_requires_local_owner_and_scoped_worker_receipt(
    scenario,  # noqa: F811
    tmp_path,
    service,
    application,
):
    case = scenario
    options = ToolsNativeOptions(
        identity_credential="identity-tools-" * 4,
        ingress="native-ingress-" * 4,
        workers={"isolated-worker": "native-worker-" * 4},
    )
    credentials = case.identity.state.identity_options["service_credentials"]
    credentials.update(tools=options.identity_credential)
    credentials[service] = f"identity-{service}-" * 4
    tools_root, project_root = tmp_path / "tools", tmp_path / service
    factory, migrations, extra = (
        create_video,
        VIDEO_MIGRATIONS,
        {"schema_path": ROOT / "web/src/generated/openapi.json"},
    )
    if service != "video":
        factory, migrations, _, _ = PROJECT_OWNERS[service]
        extra = {}
    apply(tools_root / "service.db", "tools", TOOLS_MIGRATIONS)
    apply(project_root / "service.db", service, migrations)
    projects = f"/v1/{application}/projects"
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
    app = factory(
        state_root=project_root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=credentials[service],
        **extra,
        transport=case.mesh,
        run_worker=False,
    )
    case.mesh.apps["tools"] = tools
    case.mesh.apps[service] = app
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

    def open_workshop(root, owner, application, project):
        return reveal_workshop_project(
            root, owner, application, project, launch=lambda args, **_: calls.append(args)
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
            reveal_project=open_project,
            reveal_workshop=open_workshop,
        )

    async with (
        transport.client,
        tools.router.lifespan_context(tools),
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://" + service
        ) as api,
    ):
        created = await api.post(
            projects,
            headers=await authorize(case, service, "POST", projects),
            json={
                "title": "Owned native reveal",
                **({"kind": "canvas"} if service == "visual" else {}),
            },
        )
        assert created.status_code == 200, created.text
        project = created.json()["id"]
        path = f"{projects}/{project}/open-folder"
        headers = await authorize(case, service, "POST", path)
        actor = verify_context(
            headers[HEADER],
            service=service,
            method="POST",
            path=path,
            public_key=case.key.public_key(),
        )
        assert actor.local

        def signed(**values):
            return {
                HEADER: issue_context(
                    replace(actor, **values),
                    service=service,
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
                await private.post(TOOLS_PREFIX + f"/{application}/{project}", headers=headers)
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
            / application
            / "projects"
            / project
        )
        assert calls == [["/usr/bin/open", str(folder)]]
        subfolders = (
            {"assets", "generated"} if service == "visual" else {"assets", "derived", "exports"}
        )
        assert {entry.name for entry in folder.iterdir()} == subfolders

        stray = folder.with_name(str(uuid4()))
        stray.symlink_to(folder, target_is_directory=True)
        assert open_workshop(assets_root, case.viewer, application, stray.name) == {
            "error": "project_folder_missing"
        }
        (folder / "assets").rmdir()
        (folder / "assets").symlink_to(tmp_path, target_is_directory=True)
        assert (await api.post(path, headers=headers)).status_code == 409
        assert len(calls) == 1
        (folder / "assets").unlink()
        relocated = folder.with_name(str(uuid4()))
        folder.rename(relocated)
        folder.symlink_to(relocated, target_is_directory=True)
        assert (await api.post(path, headers=headers)).status_code == 409
        assert not (relocated / "assets").exists()
        assert len(calls) == 1
    await assets_identity.close()

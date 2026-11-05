"""Exercise project deletion through live Identity, Visual and Assets boundaries."""

import json

import httpx
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS
from tests.test_independent_project_catalog import authorize

from studio.apps.asset_library.deletions import FileCleanup
from studio.apps.asset_library.references.references import AssetReferences
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.visual_workshop.application import create_app
from studio.contracts.asset_library.references import ReferenceUpdate
from studio.runtime.database.migrations import apply
from studio.runtime.http.capability_client import CapabilityClient

PROJECTS = "/v1/visual-workshop/projects"
FILES = "/v1/files"


class DeletionFaults(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.before_source_commit = None
        self.drop_commit_reply = True

    async def handle_async_request(self, request):
        reply = await self.mesh.handle_async_request(request)
        if request.url.host != "assets" or reply.status_code != 200:
            return reply
        if request.url.path.endswith("/prepare") and "visual_project_removal" in json.loads(
            request.content
        ):
            if self.before_source_commit is not None:
                await self.before_source_commit()
        if (
            self.drop_commit_reply
            and request.url.path.endswith("/commit")
            and json.loads(request.content)["deleted"]
        ):
            self.drop_commit_reply = False
            await reply.aclose()
            raise httpx.ReadError("isolated lost deletion acknowledgement", request=request)
        return reply


async def test_delete_visual_project_fences_writes_and_replays_after_lost_receipt(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    case.identity.state.identity_options["service_credentials"]["visual"] = CREDENTIALS["visual"]
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    files = CapabilityClient(
        service="assets", credential=ASSETS_SECRET, catalog=CATALOG, transport=case.mesh
    )
    case.assets.state.identity = live
    case.assets.state.capabilities = files
    faults = DeletionFaults(case.mesh)
    root = tmp_path / "visual"
    apply(root / "service.db", "visual", MIGRATIONS)
    visual = create_app(
        state_root=root,
        public_key=case.key.public_key(),
        credential=CREDENTIALS["visual"],
        catalog=CATALOG,
        transport=faults,
        run_worker=False,
    )
    case.mesh.apps["visual"] = visual

    async with (
        visual.router.lifespan_context(visual),
        httpx.AsyncClient(transport=case.mesh, base_url="http://visual") as http,
    ):

        async def send(method, path, service="visual", **kwargs):
            assertion = await authorize(case, service, method, path)
            return await http.request(
                method, f"http://{service}" + path, headers=assertion, **kwargs
            )

        created = await send(
            "POST", PROJECTS, json={"title": "Retained originals", "kind": "canvas"}
        )
        assert created.status_code == 200, created.text
        project = created.json()["id"]
        path = f"{PROJECTS}/{project}"
        canvas = await send(
            "PUT",
            path + "/canvas",
            json={
                "expected_revision": 0,
                "nodes": [
                    {"id": "notes", "kind": "text", "title": "Notes", "position": {"x": 0, "y": 0}}
                ],
                "edges": [],
            },
        )
        assert canvas.status_code == 200, canvas.text
        await visual.state.reference_delivery.process_once()
        text = await send(
            "POST",
            path + "/nodes/notes/outputs",
            json={"expected_revision": 1, "text": "Text-only revision has no Assets changes"},
        )
        assert text.status_code == 200 and text.json()["revision"] == 2, text.text
        folder = await send(
            "POST",
            "/v1/file-folders",
            "assets",
            json={"scope": "project", "project_id": project, "name": "Source"},
        )
        assert folder.status_code == 200, folder.text
        data = b"fixture for project ownership"

        async def upload(**fields):
            return await send(
                "POST",
                FILES,
                "assets",
                data=fields,
                files={"upload": ("scope.txt", data, "text/plain")},
            )

        original = await upload(project_id=project, folder_id=folder.json()["id"])
        assert original.status_code == 200, original.text
        private = original.json()["id"]
        library = await upload()
        assert library.status_code == 200, library.text
        retained = library.json()["id"]
        linked = await send(
            "POST", path + "/asset-references", "assets", json={"asset_id": retained}
        )
        assert linked.status_code == 200, linked.text
        projection = AssetReferences(case.assets.state.database)
        await projection.replace(
            owner=case.viewer,
            service="visual",
            update=ReferenceUpdate(
                request_id="own-review",
                resource_kind="acceptance",
                resource_id=project,
                resource_revision=0,
                expected_revision=0,
                asset_ids=[private],
            ),
        )

        async def foreign_consumer(revision, version, ids):
            return await projection.replace(
                owner=case.viewer,
                service="thought",
                update=ReferenceUpdate(
                    request_id=f"independent-history-{version}",
                    resource_kind="history",
                    resource_id="independent-history",
                    resource_revision=version,
                    expected_revision=revision,
                    asset_ids=ids,
                ),
            )

        await foreign_consumer(0, 0, [private])
        stale = await send("DELETE", path, params={"expected_revision": 1})
        assert stale.status_code == 409 and stale.json()["current_revision"] == 0
        blocked = await send("DELETE", path, params={"expected_revision": 0})
        assert blocked.status_code == 409 and blocked.json()["code"] == "asset_in_use"
        assert (await send("GET", path)).status_code == 200
        await foreign_consumer(1, 1, [])
        await visual.state.reference_delivery.process_once()

        async def competing_upload():
            blocked = await upload(project_id=project)
            assert blocked.status_code == 409, blocked.text
            assert blocked.json()["code"] == "project_deletion_pending"

        faults.before_source_commit = competing_upload
        lost = await send("DELETE", path, params={"expected_revision": 0})
        assert lost.status_code == 503 and lost.json()["code"] == "project_deletion_unconfirmed"
        assert not faults.drop_commit_reply
        assert (await send("GET", path)).status_code == 404
        await visual.state.reference_delivery.process_once()
        assert (await send("GET", f"{FILES}/{private}/content", "assets")).status_code == 404
        library_download = await send("GET", f"{FILES}/{retained}/content", "assets")
        assert library_download.status_code == 200 and library_download.content == data
        # The library placement was released by the same committed Assets transaction.
        assert (
            await send("DELETE", f"{FILES}/{retained}", "assets", params={"expected_revision": 0})
        ).status_code == 200
        cleanup = FileCleanup(case.assets.state.database, case.assets.state.settings)
        assert await cleanup.run_once() == 2
        assert await cleanup.run_once() == 0

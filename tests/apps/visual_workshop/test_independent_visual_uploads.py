"""Exercise native Visual uploads and their durable Assets settlement."""

import hashlib
import json
from io import BytesIO
from uuid import uuid4

import httpx
from PIL import Image

from studio.apps.asset_library.deletions import FileCleanup
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.visual_workshop.application import create_app
from studio.contracts.identity.claims import HEADER, Actor, issue_context
from studio.contracts.thought_workshop.thought_archives import ArchiveAuthenticator
from studio.contracts.visual_workshop.visual_snapshot import ARCHIVE_DOMAIN
from studio.runtime.database.migrations import apply
from studio.runtime.http.capability_client import CapabilityClient
from tests.apps.creative_workshop.test_creative_project_certification import CREDENTIALS
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    scenario,
)
from tests.apps.visual_workshop.test_visual_previs import SCENE
from tests.integration.test_independent_project_catalog import ORIGIN, authorize

PROJECTS = "/v1/visual-workshop/projects"


class UploadFaults(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.on_sealed = None
        self.drop_reply = True

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        if (
            request.url.host == "assets"
            and request.url.path.startswith("/_internal/v1/visual-upload/")
            and request.method == "POST"
            and response.status_code == 200
        ):
            await response.aread()
            if self.on_sealed is not None:
                await self.on_sealed(response.json()["items"])
            if self.drop_reply:
                self.drop_reply = False
                await response.aclose()
                raise httpx.ReadError("isolated upload acknowledgement loss", request=request)
        return response


class UploadAuthorization(httpx.AsyncBaseTransport):
    def __init__(self, case):
        self.case = case
        self.revoke_on_seal = False

    async def handle_async_request(self, request):
        if (
            self.revoke_on_seal
            and request.url.path == "/_internal/v1/asset-retention/check"
            and json.loads(request.content).get("sealed_visual_upload") is True
        ):
            self.revoke_on_seal = False
            logout = await self.case.browser.post(
                "/v1/auth/logout", headers={"Origin": ORIGIN, "X-CSRF-Token": self.case.csrf}
            )
            assert logout.status_code == 204, logout.text
        return await self.case.mesh.handle_async_request(request)


async def test_visual_uploads_recover_exact_bytes_and_rollback_competing_canvas(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    case.identity.state.identity_options["service_credentials"]["visual"] = CREDENTIALS["visual"]
    authorization = UploadAuthorization(case)
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=authorization)
    files = CapabilityClient(
        service="assets", credential=ASSETS_SECRET, catalog=CATALOG, transport=case.mesh
    )
    case.assets.state.identity = live
    case.assets.state.capabilities = files
    faults = UploadFaults(case.mesh)
    archive_key = "isolated-visual-archive-peer-key-" * 2
    case.assets.state.visual_archive_auth = ArchiveAuthenticator(archive_key, domain=ARCHIVE_DOMAIN)
    root = tmp_path / "visual"
    apply(root / "service.db", "visual", MIGRATIONS)
    visual = create_app(
        state_root=root,
        archive_key=archive_key,
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

        created = await send("POST", PROJECTS, json={"title": "Uploads", "kind": "canvas"})
        assert created.status_code == 200, created.text
        path = PROJECTS + "/" + created.json()["id"]
        await visual.state.reference_delivery.process_once()
        first, second = Image.new("RGBA", (24, 24), "red"), Image.new("RGBA", (24, 24), "blue")
        png, gif = BytesIO(), BytesIO()
        first.save(png, "PNG")
        first.save(gif, "GIF", save_all=True, append_images=[second], duration=120)
        staged = []

        async def download(identity):
            return await send("GET", f"/v1/files/{identity}/download", "assets")

        async def invisible(items):
            staged.extend(item["id"] for item in items)
            for item in items:
                assert (await download(item["id"])).status_code == 404

        faults.on_sealed = invisible
        image = await send(
            "POST",
            path + "/node-uploads",
            data={"expected_revision": 0, "x": -25, "y": 30},
            files={"file": ("asset.png", png.getvalue(), "image/png")},
        )
        assert image.status_code == 200, image.text
        assert not faults.drop_reply
        canvas = image.json()
        node = canvas["nodes"][0]
        assert node["asset_id"] == staged[0]
        assert node["position"] == {"x": -25, "y": 30}
        assert (await download(staged[0])).content == png.getvalue()
        shared_card = await send(
            "POST",
            "/v1/visual-workshop/asset-cards",
            json={"title": "共享参考图", "kind": "scene", "adopted_asset_id": staged[0]},
        )
        assert shared_card.status_code == 201, shared_card.text
        assert shared_card.json()["media_projects"] == {staged[0]: created.json()["id"]}
        assert (await send("GET", path + "/asset-cards")).json() == [shared_card.json()]
        video = {"id": "clip", "kind": "video", "title": "Clip", "position": {"x": 0, "y": 0}}
        text = {"id": "note", "kind": "text", "title": "Note", "position": {"x": 0, "y": 50}}
        saved = await send(
            "PUT",
            path + "/canvas",
            json={"expected_revision": canvas["revision"], "nodes": [node, video, text]},
        )
        assert saved.status_code == 200, saved.text
        await visual.state.reference_delivery.process_once()
        outputs = path + "/nodes/clip/outputs"

        async def upload(revision):
            return await send(
                "POST",
                path + "/nodes/clip/output-uploads",
                data={"expected_revision": revision},
                files={"file": ("anim.gif", gif.getvalue(), "image/gif")},
            )

        result = await upload(saved.json()["revision"])
        assert result.status_code == 200, result.text
        history = (await send("GET", outputs)).json()
        assert history["total"] == 1
        original = history["items"][0]
        assert [original["asset_id"], original["inspection_asset_id"]] == staged[1:3]
        assert b"ftyp" in (await download(staged[1])).content[:16]
        assert (await download(staged[2])).content.startswith(bytes.fromhex("1a45dfa3"))

        async def concurrent_edit(items):
            await invisible(items)
            text_version = await send(
                "POST",
                path + "/nodes/note/outputs",
                json={"expected_revision": result.json()["revision"], "text": "Concurrent text"},
            )
            assert text_version.status_code == 200, text_version.text

        faults.on_sealed = concurrent_edit
        stale = await upload(result.json()["revision"])
        assert stale.status_code == 409, stale.text
        await visual.state.reference_delivery.process_once()
        assert (await send("GET", outputs)).json() == history
        for identity in staged[3:]:
            assert (await download(identity)).status_code == 404
        cleanup = FileCleanup(case.assets.state.database, case.assets.state.settings)
        assert await cleanup.run_once() == 2
        assert await cleanup.run_once() == 0

        faults.on_sealed = None
        scene = await send("POST", path + "/previs-scenes", json=SCENE)
        assert scene.status_code == 201, scene.text
        scenes_path = path + "/previs-scenes"
        read_only = Actor(
            user_id=case.viewer,
            platform_role="admin",
            auth_kind="management_api_key",
            scopes=("studio:read", "studio:private_read"),
            api_key_id="read-only-test-key",
        )

        async def read_only_request(method, **kwargs):
            assertion = issue_context(
                read_only,
                service="visual",
                method=method,
                path=scenes_path,
                private_key=case.key,
                key_id="test",
            )
            return await http.request(method, scenes_path, headers={HEADER: assertion}, **kwargs)

        assert (await read_only_request("GET")).status_code == 200
        assert (await read_only_request("POST", json=SCENE)).status_code == 403
        source = {
            "request_id": str(uuid4()),
            "scene_id": scene.json()["id"],
            "scene_revision": 0,
            "shot_number": 1,
            "sha256": hashlib.sha256(png.getvalue()).hexdigest(),
        }
        current = (await send("GET", path + "/canvas")).json()

        async def publish_previs():
            return await send(
                "POST",
                path + "/node-uploads",
                data={
                    "expected_revision": current["revision"],
                    "x": 40,
                    "y": 25,
                    "previs": json.dumps(source),
                },
                files={"file": ("previs-frame.png", png.getvalue(), "image/png")},
            )

        published = await publish_previs()
        assert published.status_code == 200, published.text
        assert (await publish_previs()).json() == published.json()
        node = published.json()["nodes"][-1]
        assert node["id"] == f"previs-{source['request_id']}"
        assert (await download(node["asset_id"])).content == png.getvalue()
        archive = await send("GET", path + "/snapshot")
        assert archive.status_code == 200, archive.text
        restored = await send(
            "POST",
            PROJECTS + "/snapshot-imports",
            files={"file": ("previs.zip", archive.content, "application/zip")},
        )
        assert restored.status_code == 200, restored.text
        imported_scenes = f"{PROJECTS}/{restored.json()['project']['id']}/previs-scenes"
        assert (await send("GET", imported_scenes)).json()[0]["title"] == SCENE["title"]

        faults.on_sealed = concurrent_edit
        before = (await send("GET", path + "/canvas")).json()
        authorization.revoke_on_seal = True
        rejected = await upload(before["revision"])
        assert rejected.status_code == 401 and not authorization.revoke_on_seal, rejected.text
        await visual.state.reference_delivery.process_once()
        async with visual.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
            from studio.apps.visual_workshop.projects import Projects

            actual = await Projects(session, case.viewer).canvas(created.json()["id"])
            assert actual.model_dump(mode="json") == before
        assert await cleanup.run_once() == 0

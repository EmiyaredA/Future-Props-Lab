"""Drive both published Visual grid operations through isolated service owners."""

import io
from contextlib import AsyncExitStack

import httpx
import pytest
from PIL import Image

from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.media_rendering.settings import RenderingSettings
from studio.apps.media_rendering.storage.migrations.registry import (
    MIGRATIONS as RENDERING_MIGRATIONS,
)
from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS as VISUAL_MIGRATIONS
from studio.assembly.independent.media_rendering.application import create_app as create_rendering
from studio.assembly.independent.visual_workshop.application import create_app as create_visual
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.visual_workshop.visual_composition import (
    ASSET_PURPOSE,
    RENDER,
    GridAssetQuery,
)
from studio.runtime.database.migrations import apply
from studio.runtime.http.capability_client import (
    CapabilityClient,
    CapabilityDenied,
    CapabilityUnavailable,
)
from tests.apps.creative_workshop.test_creative_project_certification import CREDENTIALS
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize

PROJECTS = "/v1/visual-workshop/projects"
BATCHES = "/v1/visual-workshop/generation-batches"


class Faults(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.reject_grid = False
        self.drop_commit = False
        self.rendered = 0

    async def handle_async_request(self, request):
        if request.url.host == "rendering" and request.url.path.startswith(RENDER + "/"):
            if self.reject_grid:
                self.reject_grid = False
                return httpx.Response(422, json={"title": "fixture failed"})
            self.rendered += 1
        response = await self.mesh.handle_async_request(request)
        if (
            self.drop_commit
            and request.url.host == "assets"
            and request.url.path.startswith("/_internal/v1/retention/")
            and request.url.path.endswith("/commit")
        ):
            assert response.status_code == 200
            self.drop_commit = False
            await response.aclose()
            raise httpx.ReadError("lost composition publication acknowledgement", request=request)
        return response


def png(color):
    buffer = io.BytesIO()
    Image.new("RGB", (150, 100), color).save(buffer, "PNG")
    return buffer.getvalue()


async def test_native_composition_recovers_result_and_retries_failed_plan(scenario, tmp_path):  # noqa: F811
    case = scenario
    renderer = "isolated-visual-composition-renderer-" * 2
    case.identity.state.identity_options["service_credentials"].update(
        visual=CREDENTIALS["visual"],
        rendering=renderer,
    )
    for service, migrations in (("visual", VISUAL_MIGRATIONS), ("rendering", RENDERING_MIGRATIONS)):
        apply(tmp_path / service / "service.db", service, migrations)
    transport = Faults(case.mesh)

    def visual_app():
        app = create_visual(
            state_root=tmp_path / "visual",
            public_key=case.key.public_key(),
            catalog=CATALOG,
            credential=CREDENTIALS["visual"],
            transport=transport,
            run_worker=False,
        )
        case.mesh.apps["visual"] = app
        return app

    rendering = create_rendering(
        settings=RenderingSettings(tmp_path / "rendering" / "service.db"),
        public_key=case.key.public_key(),
        catalog=CATALOG,
        identity=LiveAuthorization(service="rendering", credential=renderer, transport=case.mesh),
        capabilities=CapabilityClient(
            service="rendering",
            credential=renderer,
            catalog=CATALOG,
            transport=case.mesh,
        ),
        run_worker=False,
    )
    case.mesh.apps["rendering"] = rendering
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = live
    case.assets.state.capabilities = CapabilityClient(
        service="assets", credential=ASSETS_SECRET, catalog=CATALOG, transport=case.mesh
    )
    async with (
        AsyncExitStack() as stack,
        live.client,
        rendering.router.lifespan_context(rendering),
        httpx.AsyncClient(transport=case.mesh) as http,
    ):
        visual = visual_app()
        await stack.enter_async_context(visual.router.lifespan_context(visual))

        async def send(method, path, *, service="visual", **kwargs):
            return await http.request(
                method,
                f"http://{service}" + path,
                headers=await authorize(case, service, method, path),
                **kwargs,
            )

        created = await send("POST", PROJECTS, json={"title": "Grid fixture", "kind": "canvas"})
        assert created.status_code == 200, created.text
        project = created.json()["id"]
        await visual.state.reference_delivery.process_once()
        root = f"{PROJECTS}/{project}"
        canvas_path, create = root + "/canvas", root + "/image-compositions"
        nodes = await source_nodes(send, project)
        saved = await send("PUT", canvas_path, json={"expected_revision": 0, "nodes": nodes})
        assert saved.status_code == 200, saved.text
        await visual.state.reference_delivery.process_once()

        body = {
            "grid_size": 4,
            "items": [
                {"node_id": node["id"], "asset_id": node["asset_id"], "caption": f"画格 {i + 1}"}
                for i, node in enumerate(nodes)
            ],
            "expected_canvas_revision": 1,
            "result_position": {"x": 100, "y": 200},
        }
        queued = await send("POST", create, json=body)
        assert queued.status_code == 200, queued.text
        batch = queued.json()["id"]
        assert queued.json()["status"] == "queued"
        stale = await send("POST", create, json=body)
        assert stale.status_code == 409 and stale.json()["code"] == "canvas_revision_conflict"

        transport.reject_grid = True
        await visual.state.composition_runner.process_once()
        get_batch = f"{BATCHES}/{batch}"
        failed = (await send("GET", get_batch)).json()
        assert failed["status"] == "failed" and "fixture failed" in failed["error_message"]
        retry = await send("POST", get_batch + "/retry-composition")
        assert retry.status_code == 200 and retry.json()["id"] == batch
        assert retry.json()["status"] == "queued"
        assert (await send("POST", get_batch + "/retry-composition")).status_code == 422
        assert (await send("POST", BATCHES + "/unknown/retry-composition")).status_code == 404
        original = (await authorize(case, "visual", "POST", create))[HEADER]
        query = GridAssetQuery(asset_ids=sorted(node["asset_id"] for node in nodes))
        with pytest.raises(CapabilityDenied):
            await visual.state.capabilities.authorize_request(
                original,
                RequestGrant(
                    "visual",
                    ASSET_PURPOSE,
                    "POST",
                    create,
                    "assets",
                    "POST",
                    query.path("foreign-project", batch),
                ),
            )

        transport.drop_commit = True
        with pytest.raises(CapabilityUnavailable):
            await visual.state.composition_runner.process_once()
        assert not transport.drop_commit
        pending = (await send("GET", get_batch)).json()
        assert pending["status"] == "processing" and pending["result_asset_id"] is None
        await stack.aclose()
        visual = visual_app()
        await stack.enter_async_context(visual.router.lifespan_context(visual))
        await visual.state.composition_runner.process_once()
        result = (await send("GET", get_batch)).json()
        assert result["status"] == "completed" and result["completed_count"] == 4
        assert transport.rendered == 1
        asset = result["result_asset_id"]
        original = await send("GET", f"/v1/files/{asset}/content", service="assets")
        assert original.status_code == 200, (
            original.text[:200] if original.status_code != 200 else ""
        )
        with Image.open(io.BytesIO(original.content)) as image:
            assert image.format == "PNG" and image.width == 312 and image.height > 212
            assert image.getpixel((12, 12)) == (255, 0, 0)
        output_path = f"{root}/nodes/{result['generation_node_id']}/outputs"
        history = (await send("GET", output_path)).json()["items"]
        assert len(history) == 1 and history[0]["asset_id"] == asset
        assert [row["asset_id"] for row in history[0]["input_snapshot"]] == [
            node["asset_id"] for node in nodes
        ]


async def source_nodes(send, project):
    nodes = []
    for index, color in enumerate(("red", "green", "blue", "purple")):
        response = await send(
            "POST",
            "/v1/files",
            service="assets",
            data={"project_id": project},
            files={"upload": (f"{color}.png", png(color), "image/png")},
        )
        assert response.status_code == 200, response.text
        nodes.append(
            {
                "id": f"image-{index}",
                "kind": "image",
                "title": color,
                "asset_id": response.json()["id"],
                "position": {"x": index * 60, "y": 0},
            }
        )
    return nodes

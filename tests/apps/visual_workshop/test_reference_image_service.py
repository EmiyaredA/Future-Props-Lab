"""Independent Visual uses exact Assets grants for project image registration."""

from io import BytesIO
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.visual_workshop.application import create_app
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.visual_workshop.visual_snapshot import ASSET_PURPOSE, ASSETS, snapshot_grant
from studio.runtime.database.migrations import apply
from studio.runtime.http.capability_client import CapabilityClient
from tests.apps.creative_workshop.test_creative_project_certification import CREDENTIALS
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize


@pytest.mark.parametrize("target_kind", ["selection", "identities"])
def test_reference_registration_grants_are_bound_to_project_and_purpose(target_kind):
    project, other = str(uuid4()), str(uuid4())
    source = f"/v1/visual-workshop/projects/{project}/reference-images"
    target = f"{ASSETS}/{project}/{target_kind}/{'a' * 64}"
    grant = RequestGrant("visual", ASSET_PURPOSE, "POST", source, "assets", "POST", target)
    assert snapshot_grant(grant)
    assert not snapshot_grant(
        RequestGrant(
            "visual",
            ASSET_PURPOSE,
            "POST",
            source,
            "assets",
            "POST",
            target.replace(project, other),
        )
    )
    assert not snapshot_grant(
        RequestGrant("visual", ASSET_PURPOSE, "PUT", source, "assets", "POST", target)
    )
    assert not snapshot_grant(
        RequestGrant(
            "visual",
            ASSET_PURPOSE,
            "GET",
            source.replace("reference-images", "snapshot"),
            "assets",
            "POST",
            target,
        )
    )
    assert not snapshot_grant(
        RequestGrant(
            "visual",
            ASSET_PURPOSE,
            "POST",
            source,
            "assets",
            "POST",
            target.replace(target_kind, "originals"),
        )
    )


async def test_register_project_image_through_independent_visual_and_assets(scenario, tmp_path):  # noqa: F811
    case = scenario
    case.identity.state.identity_options["service_credentials"]["visual"] = CREDENTIALS["visual"]
    case.assets.state.identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    case.assets.state.capabilities = CapabilityClient(
        service="assets", credential=ASSETS_SECRET, catalog=CATALOG, transport=case.mesh
    )
    root = tmp_path / "visual-reference-images"
    apply(root / "service.db", "visual", MIGRATIONS)
    visual = create_app(
        state_root=root,
        archive_key="reference-images-isolated-key-" * 3,
        public_key=case.key.public_key(),
        credential=CREDENTIALS["visual"],
        catalog=CATALOG,
        transport=case.mesh,
        run_worker=False,
    )
    case.mesh.apps["visual"] = visual
    async with (
        visual.router.lifespan_context(visual),
        httpx.AsyncClient(transport=case.mesh) as client,
    ):

        async def send(method, path, service="visual", **kwargs):
            return await client.request(
                method,
                f"http://{service}{path}",
                headers=await authorize(case, service, method, path),
                **kwargs,
            )

        created = await send(
            "POST", "/v1/visual-workshop/projects", json={"title": "参考登记", "kind": "canvas"}
        )
        assert created.is_success, created.text
        path = "/v1/visual-workshop/projects/" + created.json()["id"]
        await visual.state.reference_delivery.process_once()
        buffer = BytesIO()
        Image.new("RGB", (8, 8), "green").save(buffer, "PNG")
        uploaded = await send(
            "POST",
            "/v1/files",
            "assets",
            data={"project_id": created.json()["id"]},
            files={"upload": ("参考.png", buffer.getvalue(), "image/png")},
        )
        assert uploaded.is_success, uploaded.text
        body = {
            "request_id": str(uuid4()),
            "expected_revision": 0,
            "asset_id": uploaded.json()["id"],
            "kind": "scene",
            "title": "森林",
        }
        result = await send("POST", path + "/reference-images", json=body)
        assert result.is_success, result.text
        assert result.json()["card"]["kind"] == "scene"
        assert result.json()["project_card_ids"] == [result.json()["card"]["id"]]
        repeat = await send("POST", path + "/reference-images", json=body)
        assert repeat.is_success and repeat.json()["card"]["id"] == result.json()["card"]["id"]
        assert (await send("GET", path + "/asset-cards")).json() == [result.json()["card"]]

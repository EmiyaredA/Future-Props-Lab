from contextlib import aclosing

import pytest

from studio.apps.model_service.providers.zealman_workflows import U06
from test_workspace_governance import client_account

pytestmark = pytest.mark.real_auth


@pytest.mark.asyncio
async def test_workflow_models_assets_and_tasks_remain_workspace_private():
    owner, *_ = await client_account()
    other, *_ = await client_account()
    async with aclosing(owner), aclosing(other):
        catalog = (await owner.get("/v1/model-providers")).json()
        response = await owner.post(
            "/v1/model-providers",
            json={
                "expected_catalog_revision": catalog["revision"],
                "name": "ZEALMAN",
                "kind": "zealman_video",
                "base_url": "https://example.test",
                "api_key": "",
            },
        )
        provider = response.json()["provider"]
        response = await owner.post(
            f"/v1/model-providers/{provider['id']}/models",
            json={
                "expected_catalog_revision": response.json()["revision"],
                "slug": U06,
                "capabilities": ["video_generation"],
                "categories": ["video_generation"],
            },
        )
        model = response.json()["model"]
        uploaded = await owner.post(
            "/v1/model-test/generation-assets",
            files={"files": ("private.png", b"\x89PNG\r\n\x1a\nfixture", "image/png")},
        )
        assert uploaded.status_code == 200, uploaded.text
        asset_id = uploaded.json()["items"][0]["id"]
        body = {
            "kind": "video",
            "model_id": model["id"],
            "prompt": "test",
            "reference_asset_ids": [asset_id],
        }
        assert (await other.post("/v1/model-test/generation-tasks", json=body)).status_code == 404
        assert (
            await other.delete(f"/v1/model-test/generation-assets/{asset_id}")
        ).status_code == 404
        response = await owner.post("/v1/model-test/generation-tasks", json=body)
        assert response.status_code == 200, response.text
        task = response.json()
        assert (await other.get(f"/v1/model-test/generation-tasks/{task['id']}")).status_code == 404
        options = (await other.get("/v1/model-test/generation-options")).json()["items"]
        assert all(item["id"] != model["id"] for item in options)

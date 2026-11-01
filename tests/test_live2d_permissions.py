"""Private character resources and a read-only account key share one boundary."""

from contextlib import aclosing

import httpx
import pytest

from app.main import app
from test_workspace_governance import client_account

pytestmark = [pytest.mark.asyncio, pytest.mark.real_auth]


async def test_character_account_and_readonly_boundaries():
    owner, *_ = await client_account()
    outsider, *_ = await client_account()
    async with aclosing(owner), aclosing(outsider):
        created = await owner.post("/v1/live2d-workshop/projects", json={"title": "权限测试"})
        assert created.status_code == 200, created.text
        base = f"/v1/live2d-workshop/projects/{created.json()['id']}"
        assert (await outsider.get(base)).status_code == 404
        assert (await outsider.get(base + "/document")).status_code == 404
        response = await owner.post(
            "/v1/account/api-keys", json={"name": "readonly", "scopes": ["studio:read"]}
        )
        assert response.status_code == 201, response.text
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + response.json()["secret"]},
        ) as viewer:
            assert (await viewer.get(base)).status_code == 200
            document = (await viewer.get(base + "/document")).json()
            assert (
                await viewer.put(
                    base + "/document",
                    json={"expectedRevision": 0, "document": document["document"]},
                )
            ).status_code == 403
            assert (
                await viewer.post("/v1/live2d-workshop/projects", json={"title": "denied"})
            ).status_code == 403
            assert (await viewer.delete(base, params={"expectedRevision": 0})).status_code == 403
            assert (await viewer.post(base + "/exports", json={})).status_code == 403
            assert (await viewer.get(base + "/package")).status_code == 200

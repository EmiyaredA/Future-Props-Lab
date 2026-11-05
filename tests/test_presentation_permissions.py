import httpx
import pytest
from tests.presentation_helpers import sample_document
from tests.test_account_system import create_test_account, login_and_change_password, unsafe_headers

from website_test_support import app

ROOT = "/v1/presentation-workshop/projects"


@pytest.mark.asyncio
@pytest.mark.real_auth
async def test_workspace_isolation_csrf_and_read_only_export():
    first_name, first_password = await create_test_account()
    second_name, second_password = await create_test_account()
    transport = httpx.ASGITransport(app=app)
    body = {"title": "独立空间", "document": sample_document().model_dump()}
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as first,
        httpx.AsyncClient(transport=transport, base_url="http://test") as second,
    ):
        await login_and_change_password(first, first_name, first_password)
        await login_and_change_password(second, second_name, second_password)
        assert (await first.post(ROOT, json=body)).status_code == 403
        created = await first.post(ROOT, headers=unsafe_headers(first), json=body)
        assert created.status_code == 200, created.text
        url = ROOT + "/" + created.json()["id"]
        assert (await second.get(url)).status_code == 404
        assert (
            await second.put(
                url, headers=unsafe_headers(second), json={**body, "expected_revision": 0}
            )
        ).status_code == 404
        assert (
            await second.post(
                url + "/export", headers=unsafe_headers(second), json={"expected_revision": 0}
            )
        ).status_code == 404
        assert (await second.get(ROOT)).json()["total"] == 0
        key = await first.post(
            "/v1/account/api-keys",
            headers=unsafe_headers(first),
            json={
                "name": "read-only-presentation",
                "scopes": ["studio:read"],
                "expires_in_days": 30,
            },
        )
        assert key.status_code == 201, key.text
        secret = key.json()["secret"]
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", headers={"Authorization": f"Bearer {secret}"}
    ) as reader:
        assert (await reader.get(url)).status_code == 200
        assert (
            await reader.post(url + "/export", json={"expected_revision": 0})
        ).status_code == 200
        assert (await reader.post(ROOT, json=body)).status_code == 403
        assert (await reader.put(url, json={**body, "expected_revision": 0})).status_code == 403
        assert (await reader.delete(url, params={"expected_revision": 0})).status_code == 403

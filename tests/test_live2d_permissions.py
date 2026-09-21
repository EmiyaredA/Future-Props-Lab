from contextlib import aclosing

import pytest

from test_workspace_governance import client_account

pytestmark = [pytest.mark.asyncio, pytest.mark.real_auth]


async def test_character_http_workspace_and_readonly_boundaries():
    owner, _, _, workspace_id = await client_account()
    viewer, username, _, _ = await client_account()
    outsider, _, _, _ = await client_account()
    async with aclosing(owner), aclosing(viewer), aclosing(outsider):
        created = await owner.post("/v1/live2d-workshop/projects", json={"title": "权限测试"})
        assert created.status_code == 200, created.text
        base = f"/v1/live2d-workshop/projects/{created.json()['id']}"
        assert (await outsider.get(base)).status_code == 404
        assert (await outsider.get(f"{base}/document")).status_code == 404
        invitation = await owner.post(
            "/v1/account/workspaces/current/invitations",
            json={"username": username, "role": "viewer"},
        )
        assert invitation.status_code == 201, invitation.text
        inv = invitation.json()
        assert (
            await viewer.post(
                f"/v1/account/workspace-invitations/{inv['id']}/accept",
                json={"expected_revision": inv["revision"]},
            )
        ).status_code == 204
        assert (
            await viewer.post("/v1/account/workspaces/switch", json={"workspace_id": workspace_id})
        ).status_code == 200
        assert (await viewer.get(base)).status_code == 200
        document = (await viewer.get(f"{base}/document")).json()
        assert (
            await viewer.put(
                f"{base}/document", json={"expectedRevision": 0, "document": document["document"]}
            )
        ).status_code == 403
        assert (
            await viewer.post("/v1/live2d-workshop/projects", json={"title": "denied"})
        ).status_code == 403
        assert (await viewer.delete(base, params={"expectedRevision": 0})).status_code == 403
        assert (await viewer.post(f"{base}/exports", json={})).status_code == 403
        assert (await viewer.get(f"{base}/package")).status_code == 200

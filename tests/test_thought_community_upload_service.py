"""Real cross-service upload, settlement recovery and editor-only draft preview."""

import httpx
import pytest
from sqlalchemy import select
from tests.test_community_asset_protocol import (
    ASSETS_SECRET,
    scenario,  # noqa: F401
)
from tests.test_thought_archive_import_service import thought_app
from tests.test_thought_community_write_service import authorize, change_role, prepare_case

from app.capabilities.asset_store.models import VisualAsset
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.thought_workshop.publication.models import CommunityUpload
from studio.contracts.thought_workshop.community_uploads import PREFIX, public_path
from studio.contracts.thought_workshop.thought_archives import SETTLE_PATH

DATA = b"attachment from a community editor"
PATH = public_path("pub", "note")


class UploadFailure(httpx.AsyncBaseTransport):
    def __init__(self, case, step):
        self.case, self.step, self.triggered = case, step, False

    async def handle_async_request(self, request):
        response = await self.case.mesh.handle_async_request(request)
        if self.triggered or request.url.host != "assets" or response.status_code != 200:
            return response
        path = request.url.path
        if (self.step == "settle" and path == SETTLE_PATH) or (
            self.step != "settle" and path.startswith(PREFIX)
        ):
            self.triggered = True
            if self.step == "revoke":
                await change_role(self.case, "read")
            else:
                await response.aclose()
                raise httpx.ReadError("lost upload acknowledgement", request=request)
        return response


async def send(case, client, data=DATA):
    return await client.post(
        PATH,
        headers={**await authorize(case, "POST", PATH), "Idempotency-Key": "upload-retry"},
        files={"upload": ("draft.txt", data, "text/plain")},
    )


@pytest.mark.parametrize("step", ["stage", "settle", "revoke"])
async def test_community_upload_requires_a_confirmed_source_result(scenario, step):  # noqa: F811
    case = scenario
    await prepare_case(case)
    case.assets.state.identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    transport = UploadFailure(case, step)
    app = thought_app(case, transport)
    case.mesh.apps["thought"] = app
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://thought") as c,
    ):
        denied = await send(case, c)
        assert denied.status_code == 404 and not transport.triggered
        await change_role(case, "edit")
        first = await send(case, c)
        assert first.status_code == (404 if step == "revoke" else 503), first.text
        assert transport.triggered
        async with app.state.database.sessions(info={"owner_user_id": case.owner}) as session:
            rows = (await session.scalars(select(CommunityUpload))).all()
            assert len(rows) == (1 if step == "settle" else 0)
        async with case.assets.state.database.sessions(
            info={"owner_user_id": case.owner}
        ) as session:
            assert len((await session.scalars(select(VisualAsset))).all()) == (
                2 if step == "settle" else 1
            )
        if step == "revoke":
            await app.state.thought_community_uploads.process_once()
            return

    restarted = thought_app(case, case.mesh)
    case.mesh.apps["thought"] = restarted
    async with (
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted), base_url="http://thought"
        ) as c,
    ):
        await restarted.state.thought_community_uploads.recover()
        resumed = await send(case, c)
        assert resumed.status_code == 200, resumed.text
        assert (await send(case, c)).json() == resumed.json()
        assert (await send(case, c, DATA + b"changed")).status_code == 409
        asset_id = resumed.json()["asset_id"]
        content_path = f"/v1/thought-workshop/community/publications/pub/assets/{asset_id}/content"
        headers = await authorize(case, "GET", content_path)
        preview = await c.get(content_path, params={"note_id": "note"}, headers=headers)
        assert preview.status_code == 200 and preview.content == DATA, preview.text
        assert (await c.get(content_path, headers=headers)).status_code == 404
        await change_role(case, "read")
        assert (
            await c.get(content_path, params={"note_id": "note"}, headers=headers)
        ).status_code == 404

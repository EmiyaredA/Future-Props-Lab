"""Verify the isolated Assets stage protocol uses both the editor and source account."""

import base64
import hashlib
from uuid import uuid4

from sqlalchemy import select
from tests.test_community_asset_protocol import (
    ASSETS_SECRET,
    CATALOG,
    THOUGHT_SECRET,
    scenario,  # noqa: F401
)
from tests.test_thought_community_write_service import authorize

from app.capabilities.asset_store.models import VisualAsset
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.thought_workshop.community_uploads import (
    PURPOSE,
    CommunityUploadScope,
    public_path,
)
from studio.contracts.thought_workshop.thought_archives import ArchiveAuthenticator
from studio.contracts.thought_workshop.thought_uploads import ThoughtUploadDescription
from studio.runtime.http.capability_client import CapabilityClient, CapabilityDenied


async def test_upload_stage_requires_an_exact_source_grant_and_peer_proof(scenario):  # noqa: F811
    case = scenario
    case.assets.state.identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    data = b"community attachment"
    description = ThoughtUploadDescription(
        "attachment", "file.txt", "text/plain", len(data), hashlib.sha256(data).hexdigest()
    )
    scope = CommunityUploadScope(
        actor_id=case.viewer,
        owner_id=case.owner,
        publication_id="pub",
        note_id="note",
        publication_revision=0,
        article_revision=0,
        batch_id=uuid4().hex,
        descriptor_sha256=description.fingerprint,
    )
    source = public_path("pub", "note")
    assertion = (await authorize(case, "POST", source))[HEADER]
    client = CapabilityClient(
        service="thought", credential=THOUGHT_SECRET, catalog=CATALOG, transport=case.mesh
    )
    try:
        from pytest import raises

        with raises(CapabilityDenied):
            await client.authorize_request(
                assertion,
                RequestGrant(
                    "thought",
                    PURPOSE,
                    "POST",
                    public_path("pub", "other"),
                    "assets",
                    "POST",
                    scope.target,
                ),
            )
        token = await client.authorize_request(
            assertion,
            RequestGrant("thought", PURPOSE, "POST", source, "assets", "POST", scope.target),
        )
        nonce = uuid4().hex
        scope_data = scope.model_dump_json().encode()
        headers = {
            HEADER: token,
            "X-Fpl-Archive-Nonce": nonce,
            "X-Fpl-Community-Upload-Context": base64.b64encode(scope_data).decode(),
            "X-Fpl-Upload-Descriptor": description.header(),
        }
        url = "http://assets:8080" + scope.target
        denied = await client.client.post(url, headers=headers, content=data)
        assert denied.status_code == 401, denied.text
        auth = ArchiveAuthenticator("u" * 48)
        headers["X-Fpl-Community-Upload-Proof"] = auth.sign(
            "community-stage",
            path=scope.target,
            owner=scope.owner_id,
            nonce=nonce,
            body=scope_data,
        )
        first = await client.client.post(url, headers=headers, content=data)
        replay = await client.client.post(url, headers=headers, content=data)
        assert first.status_code == replay.status_code == 200, first.text
        assert first.json() == replay.json()
        auth.verify(
            first.headers["x-fpl-archive-receipt"],
            "receipt",
            path=scope.target,
            owner=scope.owner_id,
            nonce=nonce,
            body=first.content,
        )
        async with case.assets.state.database.sessions(
            info={"owner_user_id": case.owner}
        ) as session:
            assert [row.id for row in await session.scalars(select(VisualAsset))] == [case.asset]
        async with case.assets.state.database.sessions(
            info={"owner_user_id": case.viewer}
        ) as session:
            assert (await session.scalars(select(VisualAsset))).all() == []
    finally:
        await client.close()

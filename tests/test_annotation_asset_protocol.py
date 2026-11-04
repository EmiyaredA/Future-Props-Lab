"""An Annotation request can only read its account's bounded audio input."""

import io
import wave
from uuid import uuid4

import httpx
import pytest
from starlette.datastructures import Headers, UploadFile
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from app.capabilities.asset_store.library import AssetLibrary
from fpl_runtime.annotation_assets import PURPOSE, SOURCE, AudioAssetDescription, AudioAssetQuery
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityClient, CapabilityDenied
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.retention_client import RetentionClient

TOKEN = "annotation-protocol-test-" * 2


def audio():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as track:
        track.setnchannels(1)
        track.setsampwidth(2)
        track.setframerate(8000)
        track.writeframes(bytes(16000))
    return buffer.getvalue()


async def test_annotation_grant_preserves_owner_query_and_exact_revision(scenario):  # noqa: F811
    case = scenario
    body = audio()
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        source = await AssetLibrary(session, case.assets.state.settings).store_upload(
            UploadFile(
                io.BytesIO(body),
                filename="audio.wav",
                headers=Headers({"Content-Type": "audio/wav"}),
            ),
            owner_user_id=case.viewer,
        )
        file_id = source.id
    case.identity.state.identity_options["service_credentials"]["annotation"] = TOKEN
    capabilities = CapabilityClient(
        service="annotation", credential=TOKEN, catalog=CATALOG, transport=case.mesh
    )
    path = f"{SOURCE}/projects"
    context = (await authorize(case, "annotation", "POST", path))[HEADER]

    async def headers(target, *, assertion=context, method="POST", source_path=path):
        grant = RequestGrant("annotation", PURPOSE, method, source_path, "assets", "GET", target)
        return {HEADER: await capabilities.authorize_request(assertion, grant)}

    async with capabilities.client as client:
        query = AudioAssetQuery(asset_ids=[file_id])
        signed = await headers(query.path)
        info = await client.get(
            "http://assets:8080" + query.path, params={"id": file_id}, headers=signed
        )
        assert info.status_code == 200, info.text
        asset = AudioAssetDescription.model_validate(info.json()["items"][0])
        assert asset.id == file_id and asset.byte_size == len(body) and asset.media_kind == "audio"
        swapped = await client.get(
            "http://assets:8080" + query.path, params={"id": case.asset}, headers=signed
        )
        assert swapped.status_code == 403
        unauthorized = await client.get("http://assets:8080" + asset.content_path, headers=signed)
        assert unauthorized.status_code == 401
        download = await client.get(
            "http://assets:8080" + asset.content_path, headers=await headers(asset.content_path)
        )
        assert download.status_code == 200 and download.content == body
        wrong = asset.model_copy(update={"revision": asset.revision + 1}).content_path
        assert (
            await client.get("http://assets:8080" + wrong, headers=await headers(wrong))
        ).status_code == 409

        listing = (await authorize(case, "annotation", "GET", path))[HEADER]
        with pytest.raises(CapabilityDenied):
            await headers(asset.content_path, assertion=listing, method="GET")
        assert await headers(query.path, assertion=listing, method="GET")
        other = AudioAssetQuery(asset_ids=[case.asset])
        missing = await client.get(
            "http://assets:8080" + other.path,
            params={"id": case.asset},
            headers=await headers(other.path),
        )
        assert missing.status_code == 404
        browser = await httpx.ASGITransport(app=case.assets).handle_async_request(
            httpx.Request(
                "GET", "http://assets" + asset.content_path, headers={"Origin": "https://site.test"}
            )
        )
        assert browser.status_code == 403

    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = live
    retention = RetentionClient(service="annotation", credential=TOKEN, transport=case.mesh)
    project = str(uuid4())
    change = PrepareReferenceChange(
        request_id="annotation-create",
        resource_kind="project",
        resource_id=project,
        expected_resource_revision=-1,
        asset_ids=[file_id],
    )
    async with (
        live.client,
        retention.client,
        httpx.AsyncClient(
            base_url="http://assets", transport=httpx.ASGITransport(app=case.assets)
        ) as client,
    ):
        authority = await retention.authorize(
            assertion=context, source_method="POST", source_path=path, change=change
        )
        prepared = await retention.prepare(authority=authority, change=change)
        assert await retention.prepare(authority=authority, change=change) == prepared

        delete_path = "/v1/files/" + file_id
        delete = await authorize(case, "assets", "DELETE", delete_path)
        blocked = await client.delete(delete_path, headers=delete, params={"expected_revision": 0})
        assert blocked.status_code == 409, blocked.text
        await retention.commit(
            authority=authority, intent_id=prepared["intent_id"], resource_revision=0
        )
        blocked = await client.delete(delete_path, headers=delete, params={"expected_revision": 0})
        assert blocked.status_code == 409, blocked.text

        project_path = path + "/" + project
        original = (await authorize(case, "annotation", "DELETE", project_path))[HEADER]
        remove = change.model_copy(
            update={
                "request_id": "annotation-delete",
                "expected_resource_revision": 0,
                "asset_ids": [],
            }
        )
        with pytest.raises(CapabilityDenied):
            await retention.authorize(
                assertion=original,
                source_method="DELETE",
                source_path=project_path,
                change=remove.model_copy(update={"resource_id": str(uuid4())}),
            )
        authority = await retention.authorize(
            assertion=original, source_method="DELETE", source_path=project_path, change=remove
        )
        prepared = await retention.prepare(authority=authority, change=remove)
        await retention.commit(
            authority=authority,
            intent_id=prepared["intent_id"],
            resource_revision=1,
            deleted=True,
        )
        deleted = await client.delete(delete_path, headers=delete, params={"expected_revision": 0})
        assert deleted.status_code == 200, deleted.text

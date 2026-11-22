"""Independent Visual client for exact project asset metadata."""

from functools import partial

import httpx
from pydantic import TypeAdapter

from studio.apps.visual_workshop.creative_ports import CreativeAsset
from studio.contracts.asset_library.content_identity import ContentIdentities
from studio.contracts.asset_library.descriptions import LibraryAssetDescription, LibraryAssetQuery
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.visual_workshop.visual_snapshot import (
    ASSET_PURPOSE,
    ASSETS,
    CARD_MEDIA,
    CardMediaDescription,
)
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.project_errors import ProjectResourceError

DESCRIPTIONS = TypeAdapter(list[LibraryAssetDescription])
CARD_DESCRIPTIONS = TypeAdapter(list[CardMediaDescription])


def creative_asset_inspection(request, session, owner):
    return partial(request.app.state.creative_asset_scope, request, session, owner)


async def independent_reference_image_identity(request, _session, _owner, project_id, asset_id):
    body = LibraryAssetQuery(asset_ids=[asset_id])
    target = f"{ASSETS}/{project_id}/identities/{body.digest}"
    grant = RequestGrant(
        "visual", ASSET_PURPOSE, request.method, request.url.path, "assets", "POST", target
    )
    peer = request.app.state.capabilities
    try:
        token = await peer.authorize_request(request.state.service_assertion, grant)
        response = await peer.client.post(
            f"http://assets:8080{target}", headers={HEADER: token}, json=body.model_dump()
        )
        response.raise_for_status()
        result = ContentIdentities.model_validate_json(response.content)
        return next((item for item in result.items if item.asset_id == asset_id), None)
    except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError) as exc:
        raise ProjectResourceError(
            "图片内容身份暂不可用，请重试", "reference_image_unavailable", 503
        ) from exc


async def independent_creative_asset_scope(request, _session, _owner, project_id, identities):
    body = LibraryAssetQuery(asset_ids=sorted(identities))
    target = (
        f"{CARD_MEDIA}/{body.digest}"
        if project_id is None
        else f"{ASSETS}/{project_id}/selection/{body.digest}"
    )
    grant = RequestGrant(
        "visual", ASSET_PURPOSE, request.method, request.url.path, "assets", "POST", target
    )
    peer = request.app.state.capabilities
    try:
        token = await peer.authorize_request(request.state.service_assertion, grant)
        response = await peer.client.post(
            f"http://assets:8080{target}", headers={HEADER: token}, json=body.model_dump()
        )
        if response.status_code in {401, 403, 404}:
            raise ProjectResourceError("项目素材不可用", "visual_asset_scope", response.status_code)
        response.raise_for_status()
        if project_id is None:
            return {
                item.id: CreativeAsset(item.media_kind, item.mime_type, item.project_id)
                for item in CARD_DESCRIPTIONS.validate_json(response.content)
            }
        return {
            item.id: CreativeAsset(item.media_kind, item.mime_type, project_id)
            for item in DESCRIPTIONS.validate_json(response.content)
        }
    except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError) as exc:
        raise ProjectResourceError(
            "项目素材校验暂不可用", "visual_asset_scope_unavailable", 503
        ) from exc

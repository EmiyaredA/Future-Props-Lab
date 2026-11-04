"""Join Video processing metadata to narrowly delegated Assets descriptions."""

import httpx
from sqlalchemy import select

from app.apps.video_editor.errors import VideoEditorUnavailableError
from app.apps.video_editor.models import VideoEditorAssetMetadata
from app.apps.video_editor.timeline_assets import TimelineAsset
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.video_assets import MAX_IDS, PURPOSE, VideoAsset, VideoAssetQuery


class TimelineMedia:
    def __init__(self, connection, session, owner, capabilities):
        self.connection, self.session, self.owner = connection, session, owner
        self.capabilities = capabilities
        self.cache = {}

    async def describe(self, project_id, ids):
        if self.cache and self.cache.keys() >= ids:
            return {identity: self.cache[identity] for identity in ids}
        await self.session.rollback()
        ids = sorted(ids)
        originals = {}
        for offset in range(0, len(ids), MAX_IDS):
            try:
                query = VideoAssetQuery(asset_ids=ids[offset : offset + MAX_IDS])
                path = query.path(project_id)
            except ValueError:
                return {}
            grant = RequestGrant(
                "video",
                PURPOSE,
                self.connection.method,
                self.connection.url.path,
                "assets",
                "GET",
                path,
            )
            try:
                token = await self.capabilities.authorize_request(
                    self.connection.state.service_assertion, grant
                )
                response = await self.capabilities.client.get(
                    "http://assets:8080" + path,
                    params={"id": query.asset_ids},
                    headers={HEADER: token},
                )
                if response.status_code == 404:
                    return {}
                response.raise_for_status()
                rows = [VideoAsset.model_validate(item) for item in response.json()["items"]]
                if [item.id for item in rows] != query.asset_ids:
                    raise ValueError("unexpected video asset receipt")
            except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, KeyError, ValueError):
                raise VideoEditorUnavailableError("剪辑素材验证暂不可用") from None
            originals.update({row.id: row for row in rows})
        metadata = await self.session.scalars(
            select(VideoEditorAssetMetadata).where(
                VideoEditorAssetMetadata.project_id == project_id,
                VideoEditorAssetMetadata.asset_id.in_(ids),
            )
        )
        result = {
            row.asset_id: TimelineAsset.from_metadata(originals[row.asset_id].media_kind, row)
            for row in metadata
        }
        self.cache.update(result)
        return result

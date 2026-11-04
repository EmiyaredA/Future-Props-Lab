"""Use owned original descriptions and Video processing metadata for the editor."""

import httpx
from sqlalchemy import select

from app.apps.video_editor.asset_output import asset_output
from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorUnavailableError
from app.apps.video_editor.models import VideoEditorAssetMetadata
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.schemas import VideoEditorAssetListOut, VideoEditorAvailableAssetListOut
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.video_assets import PREFIX, PURPOSE, VideoAsset


class MediaReads:
    def __init__(self, request, session, owner):
        self.request, self.session, self.owner = request, session, owner
        self.capabilities = request.app.state.capabilities

    async def read(self, target):
        request = self.request
        grant = RequestGrant(
            "video", PURPOSE, request.method, request.url.path, "assets", "GET", target
        )
        try:
            token = await self.capabilities.authorize_request(
                request.state.service_assertion, grant
            )
            response = await self.capabilities.client.get(
                "http://assets:8080" + target, headers={HEADER: token}
            )
            if response.status_code == 404:
                raise VideoEditorNotFoundError("素材不存在")
            response.raise_for_status()
            return response.json()
        except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError):
            raise VideoEditorUnavailableError("剪辑素材暂不可用") from None

    async def available(self):
        await self.session.rollback()
        result = await self.read(PREFIX + "/sources")
        try:
            return VideoEditorAvailableAssetListOut.model_validate(result)
        except ValueError:
            raise VideoEditorUnavailableError("剪辑素材暂不可用") from None

    async def list(self, project):
        await VideoEditorProjects(self.session, self.owner).row(project)
        await self.session.rollback()
        result = await self.read(f"{PREFIX}/{project}/files")
        try:
            originals = [VideoAsset.model_validate(row) for row in result["items"]]
        except (ValueError, TypeError, KeyError):
            raise VideoEditorUnavailableError("剪辑素材暂不可用") from None
        metadata = {
            row.asset_id: row
            for row in await self.session.scalars(
                select(VideoEditorAssetMetadata).where(
                    VideoEditorAssetMetadata.project_id == project
                )
            )
        }
        return VideoEditorAssetListOut(
            items=[
                asset_output(project, item, metadata[item.id])
                for item in originals
                if item.id in metadata
            ]
        )

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.files.storage import AssetStorage
from app.galgame_workshop.assets import GalgameProjectAssets
from app.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from app.galgame_workshop.story import GalgameStoryDocuments, build_route_report
from app.models import GalgameAssetMetadata
from app.schemas.galgame_workshop import (
    GalgameStoryReportIssue,
    GalgameStoryRouteReportOut,
)


class GalgameReadiness:
    """Composes Story control-flow checks with the asset package manifest."""

    def __init__(self, session: AsyncSession, settings: Settings, workspace_id: str) -> None:
        self.session = session
        self.settings = settings
        self.workspace_id = workspace_id

    async def report(self, project_id: str) -> GalgameStoryRouteReportOut:
        stories = GalgameStoryDocuments(self.session)
        story = await stories.get(project_id)
        report = build_route_report(project_id, story.revision, story.document)
        try:
            rows = await stories._asset_rows(project_id, story.document)
        except GalgameStoryDocumentInvalidError as exc:
            issue = GalgameStoryReportIssue(
                code="invalid_asset_reference",
                message=str(exc),
                path="/assets",
            )
            return report.model_copy(update={"ready": False, "errors": [*report.errors, issue]})

        storage = AssetStorage(self.settings)
        missing = [
            asset
            for asset in story.document.assets
            if not storage.path_for(rows[asset.file_id]).is_file()
        ]
        errors = [
            *report.errors,
            *[
                GalgameStoryReportIssue(
                    code="missing_asset_file",
                    message="故事素材文件不存在",
                    path=f"/assets/{story.document.assets.index(asset)}",
                )
                for asset in missing
            ],
        ]
        assets_by_id = {asset.id: asset for asset in story.document.assets}
        for chapter_index, chapter in enumerate(story.document.chapters):
            for fragment_index, fragment in enumerate(chapter.fragments):
                master = fragment.timeline.master_audio if fragment.timeline else None
                if master is None:
                    continue
                story_asset = assets_by_id[master.asset_id]
                metadata = await self.session.get(GalgameAssetMetadata, story_asset.file_id)
                path = (
                    f"/chapters/{chapter_index}/fragments/{fragment_index}"
                    "/timeline/masterAudio/assetId"
                )
                if metadata is None or metadata.duration_ms is None:
                    errors.append(
                        GalgameStoryReportIssue(
                            code="timeline_master_audio_duration_unknown",
                            message="时间轴主音轨缺少可校验的媒体时长",
                            path=path,
                        )
                    )
                    continue
                if abs(metadata.duration_ms - fragment.timeline.duration_ms) > 1:
                    errors.append(
                        GalgameStoryReportIssue(
                            code="timeline_master_audio_duration_mismatch",
                            message=(
                                "时间轴主音轨时长与剧情时间轴不一致："
                                f"{metadata.duration_ms}ms / {fragment.timeline.duration_ms}ms"
                            ),
                            path=path,
                        )
                    )
        manifest = await GalgameProjectAssets(
            self.session, self.settings, self.workspace_id
        ).package_manifest(project_id)
        existing_codes = {(issue.code, issue.message) for issue in errors}
        for issue in manifest.issues:
            identity = (issue.code, issue.message)
            if identity in existing_codes:
                continue
            errors.append(
                GalgameStoryReportIssue(
                    code=issue.code,
                    message=issue.message,
                    path="/assets",
                )
            )
            existing_codes.add(identity)
        if not errors:
            return report
        return report.model_copy(update={"ready": False, "errors": errors})

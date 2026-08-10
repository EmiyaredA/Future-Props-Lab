from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.files.storage import AssetStorage
from app.galgame_workshop.assets import GalgameProjectAssets
from app.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from app.galgame_workshop.story import GalgameStoryDocuments, build_route_report
from app.schemas.galgame_workshop import (
    GalgameStoryReportIssue,
    GalgameStoryRouteReportOut,
)


class GalgameReadiness:
    """Composes Story control-flow checks with the asset package manifest."""

    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings

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
        manifest = await GalgameProjectAssets(self.session, self.settings).package_manifest(
            project_id
        )
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

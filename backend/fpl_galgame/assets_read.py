"""Join scoped Assets files with Galgame-owned story and asset metadata."""

import httpx
from pydantic import TypeAdapter
from sqlalchemy import select

from app.apps.galgame_workshop.assets.asset_analysis import GalgameAssetAnalysisMixin
from app.apps.galgame_workshop.assets.asset_support import galgame_asset_out
from app.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from app.apps.galgame_workshop.models import GalgameAssetMetadata
from app.apps.galgame_workshop.schemas import GalgameProjectAssetListOut
from app.apps.galgame_workshop.story.asset_values import validate_story_asset_media
from app.apps.galgame_workshop.story.readiness_values import (
    complete_readiness,
    invalid_asset_reference,
)
from app.apps.galgame_workshop.story.route_report import build_route_report
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.galgame_assets import PURPOSE, GalgameAssetFile, GalgameAssetQuery
from fpl_runtime.project_errors import ProjectResourceError

from .projects import Projects

FILES = TypeAdapter(list[GalgameAssetFile])


class ProjectAssetReads(GalgameAssetAnalysisMixin):
    def __init__(self, session, owner, capabilities, assertion, source_method, source_path):
        self.session = session
        self.projects = Projects(session, owner)
        self.source_method = source_method
        self.capabilities, self.assertion, self.source_path = capabilities, assertion, source_path

    async def _project(self, project_id):
        return await self.projects.row(project_id)

    async def list(self, project_id, *, query):
        await self._project(project_id)
        records = await self.asset_records(project_id, (), newest_first=True, search=query)
        return GalgameProjectAssetListOut(
            items=[galgame_asset_out(row, meta) for row, meta in records]
        )

    async def asset_records(
        self,
        project_id,
        referenced,
        *,
        newest_first,
        search="",
        project_file_id=None,
        replacement=False,
    ):
        metadata = {
            row.asset_id: row
            for row in await self.session.scalars(
                select(GalgameAssetMetadata).where(GalgameAssetMetadata.project_id == project_id)
            )
        }
        query = GalgameAssetQuery(
            asset_ids=sorted(referenced),
            search=search,
            newest_first=newest_first,
            project_file_id=project_file_id,
            replacement=replacement,
        )
        path = query.path(project_id)
        grant = RequestGrant(
            "galgame", PURPOSE, self.source_method, self.source_path, "assets", "POST", path
        )
        try:
            token = await self.capabilities.authorize_request(self.assertion, grant)
            reply = await self.capabilities.client.post(
                "http://assets:8080" + path,
                headers={HEADER: token},
                json=query.model_dump(mode="json"),
            )
            if reply.status_code in {401, 403, 404}:
                raise CapabilityDenied(reply.status_code)
            reply.raise_for_status()
            rows = FILES.validate_json(reply.content)
        except CapabilityDenied as exc:
            raise ProjectResourceError(
                "项目素材范围不可读", "project_assets_denied", exc.status
            ) from exc
        except (httpx.HTTPError, CapabilityUnavailable, ValueError) as exc:
            raise ProjectResourceError(
                "项目素材暂不可读", "project_assets_unavailable", 503
            ) from exc
        return [(row, metadata.get(row.id)) for row in rows]

    async def report(self, project_id):
        story = await self.projects.story(project_id)
        document = story.document
        report = build_route_report(project_id, story.revision, document)
        records = await self.asset_records(
            project_id, {asset.file_id for asset in document.assets}, newest_first=False
        )
        files = {row.id: row for row, _ in records}
        try:
            for asset in document.assets:
                row = files.get(asset.file_id)
                if row is None:
                    raise GalgameStoryDocumentInvalidError("故事素材引用的文件不存在")
                validate_story_asset_media(asset.type, row.media_kind, row.mime_type)
        except GalgameStoryDocumentInvalidError as exc:
            return invalid_asset_reference(report, str(exc))
        manifest = self._package_manifest_from(
            document, records, self._story_references_by_file(document)
        )
        return complete_readiness(
            report,
            document,
            missing_ids={row.id for row, _ in records if not row.exists},
            durations={row.id: metadata.duration_ms for row, metadata in records if metadata},
            manifest=manifest,
        )

    def _file_exists(self, row):
        return row.exists

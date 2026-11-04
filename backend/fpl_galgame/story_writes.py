"""Apply owned Story writes after preparing a revision-bound asset projection."""

from uuid import uuid4

from sqlalchemy import select, text

from app.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from app.apps.galgame_workshop.models import GalgameStoryDocument, GalgameStorySnapshot
from app.apps.galgame_workshop.story.asset_values import validate_story_asset_media
from app.apps.galgame_workshop.story.document_values import normalize_story_document, story_out
from app.apps.galgame_workshop.story.reference_index import sync_asset_references
from app.runtime.ids import new_id
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.project_errors import ProjectResourceError

from .projects import Projects

PREFIX = "/v1/galgame-workshop/projects"


def conflict(expected, current):
    return RevisionConflictError(
        expected, current.revision, current.model_dump(mode="json", by_alias=True)
    )


def story_error(message):
    return ProjectResourceError(message, "invalid_story_document", 422)


class StoryWrites:
    def __init__(self, session, owner, references, assertion):
        self.session, self.owner = session, owner
        self.references, self.assertion = references, assertion
        self.projects = Projects(session, owner)

    async def _prepare(self, project_id, *, expected, method, path, files=(), metadata=None):
        try:
            return await self.references.prepare(
                owner=self.owner,
                assertion=self.assertion,
                source_method=method,
                source_path=path,
                change=PrepareReferenceChange(
                    request_id=uuid4().hex,
                    resource_kind="story",
                    resource_id=project_id,
                    expected_resource_revision=expected,
                    asset_ids=sorted(files),
                    metadata_asset_ids=metadata,
                ),
            )
        except CapabilityDenied as exc:
            scope = {
                "story_visual_asset_scope": "不能引用视觉工坊的私有素材",
                "story_galgame_asset_scope": "不能引用其他 Galgame 工程的私有素材",
            }
            if exc.code in scope:
                raise story_error(scope[exc.code]) from exc
            if exc.status == 404:
                raise story_error("故事素材引用的文件不存在") from exc
            if exc.status == 409 and expected >= 0:
                current = await self.projects.story(project_id)
                if current.revision != expected:
                    raise conflict(expected, current) from exc
                raise ProjectResourceError(
                    "素材引用状态未核验", "retention_unconfirmed", 503
                ) from exc
            raise ProjectResourceError(
                "素材引用准备被拒绝", "retention_denied", exc.status
            ) from exc
        except CapabilityUnavailable as exc:
            raise ProjectResourceError("素材引用结果未确认", "retention_unconfirmed", 503) from exc

    async def _commit(self, prepared, apply):
        try:
            result = await apply()
            await self.references.record(self.session, prepared, resource_revision=result.revision)
        except BaseException:
            await self.session.rollback()
            await self.references.abort_after_rollback(self.session, prepared)
            raise
        # Once commit starts, only the durable outcome can decide a remote abort.
        await self.session.commit()
        return result

    async def create_project(self, body):
        project_id = new_id()
        prepared = await self._prepare(project_id, expected=-1, method="POST", path=PREFIX)

        async def apply():
            return await self.projects.create(body, project_id=project_id)

        return await self._commit(prepared, apply)

    async def put(self, project_id, body):
        current = await self.projects.story(project_id)
        if current.revision != body.expected_revision:
            raise conflict(body.expected_revision, current)
        files = {asset.file_id for asset in body.document.assets}
        snapshots = await self.session.scalars(
            select(GalgameStorySnapshot.document).where(
                GalgameStorySnapshot.project_id == project_id
            )
        )
        try:
            historic = {
                asset.file_id
                for snapshot in snapshots
                for asset in normalize_story_document(snapshot).assets
            }
        except GalgameStoryDocumentInvalidError as exc:
            raise story_error(str(exc)) from exc
        await self.session.rollback()
        prepared = await self._prepare(
            project_id,
            expected=body.expected_revision,
            method="PUT",
            path=f"{PREFIX}/{project_id}/story",
            files=files | historic,
            metadata=sorted(files),
        )

        async def apply():
            descriptions = {item.id: item for item in prepared.metadata}
            try:
                for asset in body.document.assets:
                    description = descriptions[asset.file_id]
                    validate_story_asset_media(
                        asset.type, description.media_kind, description.mime_type
                    )
            except GalgameStoryDocumentInvalidError as exc:
                raise story_error(str(exc)) from exc
            await self.session.execute(text("BEGIN IMMEDIATE"))
            project = await self.projects.row(project_id)
            row = await self.session.get(GalgameStoryDocument, project_id)
            if row is None:
                raise ProjectResourceError("故事文档不存在")
            if row.revision != body.expected_revision:
                raise conflict(
                    body.expected_revision, story_out(row, normalize_story_document(row.document))
                )
            now = utc_now()
            row.document = body.document.model_dump(mode="json", by_alias=True)
            row.revision += 1
            row.updated_at = now
            if project.status == "completed":
                project.status = "draft"
                project.revision += 1
                project.updated_at = now
            await sync_asset_references(self.session, project_id, files)
            return story_out(row, body.document)

        return await self._commit(prepared, apply)

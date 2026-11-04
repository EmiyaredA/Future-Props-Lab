"""Apply owned Story writes after preparing a revision-bound asset projection."""

from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select, text

from app.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from app.apps.galgame_workshop.models import GalgameStoryDocument, GalgameStorySnapshot
from app.apps.galgame_workshop.schemas import (
    GalgameStoryDialoguePatchOut,
    GalgameStoryDocumentOut,
    GalgameStoryStageExpressionPatchOut,
)
from app.apps.galgame_workshop.story.asset_values import validate_story_asset_media
from app.apps.galgame_workshop.story.document_values import normalize_story_document, story_out
from app.apps.galgame_workshop.story.edit_values import (
    apply_dialogue,
    apply_edits,
    apply_stage_expression,
)
from app.apps.galgame_workshop.story.migration_inventory import normalize_legacy_import
from app.apps.galgame_workshop.story.operation_values import transform
from app.apps.galgame_workshop.story.reference_index import sync_asset_references
from app.runtime.ids import new_id
from app.runtime.operation_receipts import record, replay
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
        except ValidationError as exc:
            raise story_error("故事素材引用无效或过多") from exc
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

    async def create_project(self, body):
        project_id = new_id()
        prepared = await self._prepare(project_id, expected=-1, method="POST", path=PREFIX)

        async def apply():
            return await self.projects.create(body, project_id=project_id)

        return await self.references.commit_source(self.session, prepared, apply)

    async def current_story(self, project_id, expected_revision):
        current = await self.projects.story(project_id)
        if current.revision != expected_revision:
            raise conflict(expected_revision, current)
        return current

    async def put(self, project_id, body):
        await self.current_story(project_id, body.expected_revision)
        return await self._save(
            project_id,
            expected_revision=body.expected_revision,
            document=body.document,
            method="PUT",
            path=f"{PREFIX}/{project_id}/story",
        )

    async def import_legacy(self, project_id, expected_revision, raw):
        try:
            document = normalize_legacy_import(raw)
        except GalgameStoryDocumentInvalidError as exc:
            raise story_error(str(exc)) from exc
        await self.current_story(project_id, expected_revision)
        return await self._save(
            project_id,
            expected_revision=expected_revision,
            document=document,
            method="POST",
            path=f"{PREFIX}/{project_id}/story/import",
        )

    async def repair_asset(self, project_id, body, document):
        return await self._save(
            project_id,
            expected_revision=body.expected_story_revision,
            document=document,
            method="POST",
            path=f"{PREFIX}/{project_id}/assets/repair",
        )

    async def save_voice_matches(self, project_id, body):
        return await self._save(
            project_id,
            expected_revision=body.expected_revision,
            document=body.document,
            method="POST",
            path=f"{PREFIX}/{project_id}/assets/asr/match-dialogue",
        )

    async def patch_edits(self, project_id, body):
        story, _ = await self._patch(project_id, body, "edits", apply_edits)
        return story

    async def patch_dialogue(self, project_id, body):
        story, block = await self._patch(project_id, body, "dialogue", apply_dialogue)
        return GalgameStoryDialoguePatchOut(
            project_id=project_id, revision=story.revision, updated_at=story.updated_at, block=block
        )

    async def patch_stage_expression(self, project_id, body):
        story, block = await self._patch(
            project_id, body, "stage-expression", apply_stage_expression
        )
        return GalgameStoryStageExpressionPatchOut(
            project_id=project_id, revision=story.revision, updated_at=story.updated_at, block=block
        )

    async def _patch(self, project_id, body, segment, apply_edit):
        current = await self.current_story(project_id, body.expected_revision)
        payload = current.document.model_dump(mode="json", by_alias=True)
        try:
            edited = apply_edit(payload, body)
            if segment == "edits":
                document = edited
            else:
                document = normalize_story_document(payload)
        except GalgameStoryDocumentInvalidError as exc:
            raise story_error(str(exc)) from exc
        story = await self._save(
            project_id,
            expected_revision=body.expected_revision,
            document=document,
            method="PATCH",
            path=f"{PREFIX}/{project_id}/story/{segment}",
        )
        return story, edited

    async def apply_operations(self, project_id, body):
        current = await self.projects.story(project_id)
        key = dict(owner_user_id=self.owner, kind="galgame", resource_id=project_id, body=body)
        saved = await replay(self.session, **key)
        if saved is not None:
            return GalgameStoryDocumentOut.model_validate(saved)
        if current.revision != body.expected_revision:
            raise conflict(body.expected_revision, current)
        candidate = transform(current, body)
        try:
            return await self._save(
                project_id,
                expected_revision=candidate.expected_revision,
                document=candidate.document,
                method="POST",
                path=f"{PREFIX}/{project_id}/story/operations",
                record_operation=lambda result: record(self.session, **key, result=result),
            )
        except RevisionConflictError:
            saved = await replay(self.session, **key)
            if saved is not None:
                return GalgameStoryDocumentOut.model_validate(saved)
            raise

    async def restore_snapshot(self, project_id, snapshot_id, expected_revision):
        await self.projects.row(project_id)
        snapshot = await self.session.scalar(
            select(GalgameStorySnapshot).where(
                GalgameStorySnapshot.project_id == project_id,
                GalgameStorySnapshot.id == snapshot_id,
            )
        )
        if snapshot is None:
            raise ProjectResourceError("维护快照不存在")
        await self.current_story(project_id, expected_revision)
        try:
            document = normalize_story_document(snapshot.document)
        except GalgameStoryDocumentInvalidError as exc:
            raise story_error(str(exc)) from exc
        return await self._save(
            project_id,
            expected_revision=expected_revision,
            document=document,
            method="POST",
            path=f"{PREFIX}/{project_id}/story/snapshots/{snapshot_id}/restore",
        )

    async def _save(
        self, project_id, *, expected_revision, document, method, path, record_operation=None
    ):
        files = {asset.file_id for asset in document.assets}
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
            expected=expected_revision,
            method=method,
            path=path,
            files=files | historic,
            metadata=sorted(files),
        )

        async def apply():
            descriptions = {item.id: item for item in prepared.metadata}
            try:
                for asset in document.assets:
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
            if row.revision != expected_revision:
                raise conflict(
                    expected_revision, story_out(row, normalize_story_document(row.document))
                )
            now = utc_now()
            row.document = document.model_dump(mode="json", by_alias=True)
            row.revision += 1
            row.updated_at = now
            if project.status == "completed":
                project.status = "draft"
                project.revision += 1
                project.updated_at = now
            await sync_asset_references(self.session, project_id, files)
            return story_out(row, document)

        return await self.references.commit_source(self.session, prepared, apply, record_operation)

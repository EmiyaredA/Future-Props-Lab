"""Delete one owned Galgame project while Assets retains the exact removal outcome."""

from uuid import uuid4

import httpx
from sqlalchemy import delete, select, text, union_all

from app.runtime.operation_receipts import forget
from app.runtime.project_records import delete_revisioned_project
from studio.apps.galgame_workshop.storage.models import (
    GalgameAnnotationImportTask,
    GalgameAssetTranscriptionTask,
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
)
from studio.apps.galgame_workshop.storage.service_models import (
    GalgameHandoffDispatch,
    GalgameStoryReferenceMutation,
    GalgameUploadIntake,
    GalgameVideoDispatch,
)
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.project_errors import ProjectResourceError
from studio.runtime.revisions import RevisionConflictError

from .projects import Projects

TASKS = (
    GalgameAnnotationImportTask,
    GalgameAssetTranscriptionTask,
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
)


class ProjectDeletion:
    def __init__(self, request, session, owner):
        self.request, self.session, self.owner = request, session, owner
        self.projects = Projects(session, owner)
        self.references = request.app.state.reference_mutations
        self.delivery = request.app.state.reference_delivery

    async def settle(self, identity):
        try:
            await self.delivery.deliver(self.owner, identity)
        except (CapabilityDenied, CapabilityUnavailable) as exc:
            raise ProjectResourceError(
                "项目素材结果正在确认", "project_deletion_unconfirmed", 503
            ) from exc

    async def settle_prior(self, project_id):
        identities = list(
            await self.session.scalars(
                select(GalgameStoryReferenceMutation.request_id)
                .where(
                    GalgameStoryReferenceMutation.state == "commit",
                    GalgameStoryReferenceMutation.change["resource_kind"].as_string() == "story",
                    GalgameStoryReferenceMutation.change["resource_id"].as_string() == project_id,
                )
                .order_by(GalgameStoryReferenceMutation.created_at)
            )
        )
        await self.session.rollback()
        for identity in identities:
            await self.settle(identity)

    async def require_idle(self, project_id):
        intake = await self.session.scalar(
            select(GalgameUploadIntake.id)
            .where(
                GalgameUploadIntake.project_id == project_id,
                GalgameUploadIntake.state.in_(("reserved", "pending")),
            )
            .limit(1)
        )
        if intake is not None:
            raise ProjectResourceError("项目素材尚未确认", "project_upload_pending", 409)
        for model in TASKS:
            job = await self.session.scalar(
                select(model.id)
                .where(model.project_id == project_id, model.status.in_(("queued", "running")))
                .limit(1)
            )
            if job is not None:
                raise ProjectResourceError("项目仍有运行中的任务", "project_tasks_pending", 409)

    async def prepare(self, project_id, story_revision):
        change = PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="story",
            resource_id=project_id,
            expected_resource_revision=story_revision,
            asset_ids=[],
            galgame_project_removal=True,
        )
        try:
            return await self.references.prepare(
                owner=self.owner,
                assertion=self.request.state.service_assertion,
                source_method="DELETE",
                source_path=self.request.url.path,
                change=change,
            )
        except (CapabilityDenied, CapabilityUnavailable) as exc:
            await self.references.abandon_preparation(self.session, self.owner, change)
            if isinstance(exc, CapabilityDenied) and exc.status == 409:
                raise ProjectResourceError(
                    "项目素材正在使用", exc.code or "asset_in_use", 409
                ) from exc
            raise ProjectResourceError(
                "项目删除结果尚未确认", "project_deletion_unconfirmed", 503
            ) from exc

    async def delete(self, project_id, expected_revision):
        current = await self.projects.get(project_id)
        if current.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision, current.revision, current.model_dump(mode="json")
            )
        await self.settle_prior(project_id)
        await self.require_idle(project_id)
        try:
            state = self.request.app.state
            for runner in (state.export_runner, state.handoff_runner):
                await runner.release_project(
                    self.session,
                    self.owner,
                    project_id,
                    self.request.state.service_assertion,
                    ("DELETE", self.request.url.path),
                )
        except (ProjectResourceError, CapabilityUnavailable, httpx.HTTPError, ValueError) as exc:
            raise ProjectResourceError(
                "视频导出回执尚未清理", "project_export_receipt_pending", 503
            ) from exc
        story_revision = (await self.projects.story(project_id)).revision
        await self.session.rollback()
        prepared = await self.prepare(project_id, story_revision)
        try:
            await self.session.execute(text("BEGIN IMMEDIATE"))
            await self.require_idle(project_id)
            receipts = union_all(
                *(
                    select(dispatch.task_id)
                    .join(task, task.id == dispatch.task_id)
                    .where(task.project_id == project_id)
                    for dispatch, task in (
                        (GalgameVideoDispatch, GalgameVideoExportTask),
                        (GalgameHandoffDispatch, GalgameVideoEditorHandoffTask),
                    )
                )
            )
            unsettled = await self.session.scalar(receipts.limit(1))
            if unsettled is not None:
                raise ProjectResourceError(
                    "视频导出回执尚未清理", "project_export_receipt_pending", 409
                )
            story = await self.projects.story(project_id)
            if story.revision != story_revision:
                raise ProjectResourceError(
                    "Story 已更新，请重试项目删除", "story_revision_changed", 409
                )
            for model in TASKS:
                await self.session.execute(delete(model).where(model.project_id == project_id))
            await delete_revisioned_project(
                self.session,
                GalgameWorkshopProject,
                project_id,
                self.owner,
                expected_revision=expected_revision,
                load_current=lambda: self.projects.get(project_id),
            )
            await forget(
                self.session, owner_user_id=self.owner, kind="galgame", resource_id=project_id
            )
            await self.references.record(
                self.session, prepared, resource_revision=story_revision + 1, deleted=True
            )
        except BaseException:
            await self.session.rollback()
            await self.references.abort_after_rollback(self.session, prepared)
            raise
        await self.session.commit()
        await self.settle(prepared.request_id)

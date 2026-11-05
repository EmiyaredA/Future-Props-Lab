"""Commit the owned project deletion and its exact Assets decision together."""

from uuid import uuid4

from sqlalchemy import select, text

from app.runtime.operation_receipts import forget
from app.runtime.project_records import delete_revisioned_project
from studio.apps.visual_workshop.acceptance.models import AcceptanceRun
from studio.apps.visual_workshop.acceptance.standards import delete_acceptance
from studio.apps.visual_workshop.generation_records import ACTIVE_TASK_STATUSES
from studio.apps.visual_workshop.handoffs.segment_handoffs import require_canvas_unreserved
from studio.apps.visual_workshop.storage.assistant_dispatch_records import VisualAssistantDispatch
from studio.apps.visual_workshop.storage.generation_dispatch_records import VisualGenerationDispatch
from studio.apps.visual_workshop.storage.models import (
    VisualAssistantConversation,
    VisualAssistantMessage,
    VisualGenerationBatch,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.project_errors import ProjectResourceError

from .canvas_writes import conflict
from .projects import Projects
from .reference_backlog import pending_outcomes


class ProjectDeletion:
    def __init__(self, request, session, owner):
        self.request, self.session, self.owner = request, session, owner
        self.projects = Projects(session, owner)
        self.references = request.app.state.reference_mutations
        self.delivery = request.app.state.reference_delivery

    async def _deliver(self, identity):
        try:
            await self.delivery.deliver(self.owner, identity)
        except (CapabilityDenied, CapabilityUnavailable) as exc:
            raise ProjectResourceError(
                "项目素材结果正在确认", "project_deletion_unconfirmed", 503
            ) from exc

    async def _require_idle(self, project_id):
        await require_canvas_unreserved(self.session, self.owner, project_id)
        for model, statuses in (
            (VisualGenerationTask, ACTIVE_TASK_STATUSES),
            (VisualGenerationBatch, ("queued", "processing")),
            (AcceptanceRun, ("queued", "processing")),
        ):
            if (
                await self.session.scalar(
                    select(model.id)
                    .where(model.project_id == project_id, model.status.in_(statuses))
                    .limit(1)
                )
                is not None
            ):
                raise ProjectResourceError("项目仍有运行中的任务", "project_tasks_pending", 409)
        unconfirmed = await self.session.scalar(
            select(VisualGenerationDispatch.task_id)
            .join(VisualGenerationTask, VisualGenerationTask.id == VisualGenerationDispatch.task_id)
            .where(
                VisualGenerationTask.project_id == project_id,
                VisualGenerationDispatch.remote_output_sha256.is_not(None),
            )
            .limit(1)
        )
        if unconfirmed is not None:
            raise ProjectResourceError("生成结果正在结算", "project_tasks_pending", 409)
        pending = await self.session.scalar(
            select(VisualAssistantMessage.id)
            .join(
                VisualAssistantConversation,
                VisualAssistantConversation.id == VisualAssistantMessage.conversation_id,
            )
            .where(
                VisualAssistantConversation.project_id == project_id,
                VisualAssistantMessage.status == "pending",
            )
            .limit(1)
        )
        if pending is not None:
            raise ProjectResourceError("生成期间不能删除项目", "conversation_busy", 409)

        settling = await self.session.scalar(
            select(VisualAssistantDispatch.run_id)
            .where(VisualAssistantDispatch.project_id == project_id)
            .limit(1)
        )
        if settling is not None:
            raise ProjectResourceError("项目对话仍在结算", "conversation_busy", 409)

    async def _conversations(self, project_id):
        return list(
            await self.session.scalars(
                select(VisualAssistantConversation.id)
                .where(VisualAssistantConversation.project_id == project_id)
                .order_by(VisualAssistantConversation.id)
            )
        )

    async def _prepare(self, project_id, revision, conversations):
        change = PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="canvas",
            resource_id=project_id,
            expected_resource_revision=revision,
            asset_ids=[],
            visual_project_removal=conversations,
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
            if isinstance(exc, CapabilityDenied) and exc.status != 503:
                raise ProjectResourceError(
                    "项目素材范围不能删除", exc.code or "project_deletion_denied", exc.status
                ) from exc
            raise ProjectResourceError(
                "项目删除结果尚未确认", "project_deletion_unconfirmed", 503
            ) from exc

    async def delete(self, project_id, expected_revision):
        project = await self.projects.get(project_id)
        if project.revision != expected_revision:
            raise conflict(expected_revision, project)
        await self._require_idle(project_id)
        revision = (await self.projects.canvas_row(project_id)).revision
        conversations = await self._conversations(project_id)
        for identity in await pending_outcomes(self.session, project_id, conversations):
            await self._deliver(identity)
        prepared = await self._prepare(project_id, revision, conversations)
        try:
            await self.session.execute(text("BEGIN IMMEDIATE"))
            canvas = await self.projects.canvas_row(project_id)
            await self._require_idle(project_id)
            if (
                canvas.revision != revision
                or await self._conversations(project_id) != conversations
            ):
                raise ProjectResourceError(
                    "项目内容已更新，请重试删除", "project_contents_changed", 409
                )
            await delete_acceptance(self.session, project_id)
            await delete_revisioned_project(
                self.session,
                VisualWorkshopProject,
                project_id,
                self.owner,
                expected_revision=expected_revision,
                load_current=lambda: self.projects.get(project_id),
            )
            await forget(
                self.session, owner_user_id=self.owner, kind="visual", resource_id=project_id
            )
            await self.references.record(
                self.session, prepared, resource_revision=revision + 1, deleted=True
            )
        except BaseException:
            await self.session.rollback()
            await self.references.abort_after_rollback(self.session, prepared)
            raise
        await self.session.commit()
        await self._deliver(prepared.request_id)

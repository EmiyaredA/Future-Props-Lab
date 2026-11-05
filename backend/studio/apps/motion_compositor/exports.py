"""Preserve the public export lifecycle while Rendering owns execution and files."""

from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from studio.apps.motion_compositor.projects import MotionInvalid, MotionNotFound, MotionProjects
from studio.apps.motion_compositor.schemas import ExportListOut, ExportOut
from studio.apps.motion_compositor.storage.models import MotionDocument, MotionTask
from studio.apps.motion_compositor.storage.service_models import MotionExportBinding
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.motion_compositor.motion_exports import (
    PREFIX,
    PURPOSE,
    RenderRequest,
    RenderWindow,
    export_media,
)
from studio.contracts.motion_compositor.motion_preview import (
    MAX_SCENE_BYTES,
    FrameFile,
    FrameScope,
    sha256,
)
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now

from .export_delivery import ACTIVE


def export_out(row):
    path = f"/v1/motion-compositor/projects/{row.project_id}/exports/{row.id}"
    return ExportOut(
        id=row.id,
        status=row.status,
        progress=row.progress,
        formats=row.request_payload["formats"],
        outputs={key: f"{path}/download/{key}" for key in row.outputs},
        error=row.error,
    )


class Exports:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner
        self.projects = MotionProjects(session, owner)

    async def previous(self, project_id, body, payload):
        row = await self.session.scalar(
            select(MotionTask).where(
                MotionTask.project_id == project_id, MotionTask.request_id == body.request_id
            )
        )
        if row is not None and row.request_payload != payload:
            raise MotionInvalid("requestId 已用于不同导出任务")
        return export_out(row) if row is not None else None

    async def prepare(self, request, project_id, body, snapshot):
        document = snapshot.document
        end = body.end_frame or document.settings.duration_frames
        if body.start_frame >= end or end > document.settings.duration_frames:
            raise MotionInvalid("导出范围超出项目时长")
        assets = await self.projects.resources.describe_assets(
            project_id, export_media(document, body.start_frame, end)
        )
        frozen = RenderRequest(
            window=RenderWindow(start=body.start_frame, end=end, formats=tuple(body.formats)),
            document=document.model_dump(mode="json", by_alias=True),
            scope=FrameScope(
                files=tuple(
                    FrameFile(id=key, revision=assets[key].revision) for key in sorted(assets)
                )
            ),
        )
        raw = frozen.model_dump_json().encode()
        if len(raw) > MAX_SCENE_BYTES:
            raise MotionInvalid("导出文档超过大小限制")
        remote_id = uuid4().hex
        path = f"{PREFIX}/{project_id}/{remote_id}/{sha256(raw)}/{frozen.scope.digest}"
        grant = RequestGrant("motion", PURPOSE, "POST", request.url.path, "rendering", "POST", path)
        assertion = await request.app.state.motion_capabilities.authorize_request(
            request.state.service_assertion, grant
        )
        return MotionExportBinding(
            owner_user_id=self.owner,
            remote_id=remote_id,
            request_path=path,
            assertion=assertion,
            frozen_request=frozen.model_dump(mode="json"),
        )

    async def create(self, request, project_id, body):
        payload = body.model_dump(mode="json", by_alias=True)
        await self.projects.row(project_id)
        replay = await self.previous(project_id, body, payload)
        if replay is not None:
            return replay
        snapshot = await self.projects.document(project_id)
        check_revision(body, snapshot)
        binding = await self.prepare(request, project_id, body, snapshot)

        # Take the SQLite writer lock with a no-op CAS before allocating the request ID.
        cas = await self.session.execute(
            update(MotionDocument)
            .where(
                MotionDocument.project_id == project_id,
                MotionDocument.revision == snapshot.revision,
            )
            .values(revision=MotionDocument.revision)
        )
        if cas.rowcount != 1:
            await self.session.rollback()
            replay = await self.previous(project_id, body, payload)
            if replay is not None:
                return replay
            check_revision(body, await self.projects.document(project_id))
            raise MotionNotFound("特效文档不存在")
        task = MotionTask(
            id=new_id(),
            owner_user_id=self.owner,
            project_id=project_id,
            request_id=body.request_id,
            request_payload=payload,
            snapshot_document=snapshot.document.model_dump(mode="json", by_alias=True),
            outputs={},
        )
        binding.task_id = task.id
        self.session.add_all((task, binding))
        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            replay = await self.previous(project_id, body, payload)
            if replay is not None:
                return replay
            raise
        return export_out(task)

    async def list(self, project_id):
        await self.projects.row(project_id)
        rows = await self.session.scalars(
            select(MotionTask)
            .where(MotionTask.project_id == project_id)
            .order_by(MotionTask.created_at.desc())
        )
        return ExportListOut(items=[export_out(row) for row in rows])

    async def task(self, project_id, task_id):
        row = await self.session.scalar(
            select(MotionTask).where(MotionTask.id == task_id, MotionTask.project_id == project_id)
        )
        if row is None:
            raise MotionNotFound("导出任务不存在")
        return row

    async def cancel(self, project_id, task_id):
        row = await self.task(project_id, task_id)
        if row.status in ACTIVE:
            await self.session.execute(
                update(MotionTask)
                .where(MotionTask.id == task_id, MotionTask.status == row.status)
                .values(
                    status="cancelled" if row.status == "queued" else row.status,
                    cancel_requested=True,
                    updated_at=utc_now(),
                )
            )
            await self.session.commit()
            await self.session.refresh(row)
        return export_out(row)

    async def output(self, project_id, task_id, format_name):
        row = await self.task(project_id, task_id)
        if row.status != "completed" or format_name not in row.outputs:
            raise MotionNotFound("导出文件不存在")
        binding = await self.session.get(MotionExportBinding, task_id)
        if binding is None:
            raise MotionNotFound("导出文件不存在")
        self.session.expunge(binding)
        await self.session.rollback()
        return binding


def check_revision(body, snapshot):
    if snapshot.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision,
            snapshot.revision,
            snapshot.model_dump(mode="json", by_alias=True),
        )

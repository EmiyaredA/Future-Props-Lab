"""Account-private room use cases; all persistent writes go through these APIs."""

import hashlib
import json
import shutil

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from app.capabilities.identity.principal import StudioPrincipal
from app.runtime.ids import new_id
from app.runtime.operation_receipts import OperationError, fingerprint, record, replay
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now

from .files import exclusive_write, material_path, receive_material, room_root
from .models import InterviewMaterial, InterviewPreparation, InterviewRoom
from .schemas import (
    InterviewMaterialOut,
    InterviewRoomOut,
    InterviewRoomSummary,
    InterviewTaskOut,
)

ACTIVE = {"queued", "running", "validating"}


def task_out(row):
    return InterviewTaskOut.model_validate(row, from_attributes=True)


class Rooms:
    def __init__(self, session, principal: StudioPrincipal):
        self.session, self.principal = session, principal

    async def get_row(self, room_id):
        row = await self.session.scalar(
            select(InterviewRoom).where(
                InterviewRoom.id == room_id,
                InterviewRoom.owner_user_id == self.principal.owner_user_id,
                InterviewRoom.user_id == self.principal.user_id,
            )
        )
        if row is None:
            raise OperationError("面试场次不存在", "not_found", 404)
        return row

    async def get(self, room_id):
        row = await self.get_row(room_id)
        materials = list(
            await self.session.scalars(
                select(InterviewMaterial)
                .where(InterviewMaterial.room_id == row.id)
                .order_by(InterviewMaterial.created_at)
            )
        )
        tasks = list(
            await self.session.scalars(
                select(InterviewPreparation)
                .where(InterviewPreparation.room_id == row.id)
                .order_by(InterviewPreparation.created_at.desc())
            )
        )
        return InterviewRoomOut(
            **{
                key: getattr(row, key)
                for key in (
                    "id",
                    "title",
                    "revision",
                    "input_version",
                    "active_task_id",
                    "active_bundle_id",
                    "created_at",
                    "updated_at",
                )
            },
            materials=[
                InterviewMaterialOut.model_validate(item, from_attributes=True)
                for item in materials
            ],
            tasks=[task_out(item) for item in tasks],
        )

    async def list(self):
        ids = list(
            await self.session.scalars(
                select(InterviewRoom.id)
                .where(
                    InterviewRoom.owner_user_id == self.principal.owner_user_id,
                    InterviewRoom.user_id == self.principal.user_id,
                )
                .order_by(InterviewRoom.updated_at.desc())
                .limit(100)
            )
        )
        return [
            InterviewRoomSummary.model_validate(await self.get_row(room_id), from_attributes=True)
            for room_id in ids
        ]

    async def create(self, body):
        receipt = dict(
            owner_user_id=self.principal.owner_user_id,
            kind="interview-create",
            resource_id=self.principal.user_id,
            body=body,
        )
        previous = await replay(self.session, **receipt)
        if previous:
            return await self.get(previous["id"])
        row = InterviewRoom(
            owner_user_id=self.principal.owner_user_id,
            user_id=self.principal.user_id,
            title=body.title.strip() or "新面试",
        )
        self.session.add(row)
        await self.session.flush()
        result = await self.get(row.id)
        record(self.session, **receipt, result=result)
        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            previous = await replay(self.session, **receipt)
            if not previous:
                raise
            return await self.get(previous["id"])
        return result

    async def cas(self, room_id, expected, **values):
        result = await self.session.execute(
            update(InterviewRoom)
            .where(
                InterviewRoom.id == room_id,
                InterviewRoom.owner_user_id == self.principal.owner_user_id,
                InterviewRoom.user_id == self.principal.user_id,
                InterviewRoom.revision == expected,
            )
            .values(revision=InterviewRoom.revision + 1, updated_at=utc_now(), **values)
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get(room_id)
            raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))

    async def upload(self, room_id, expected, incoming):
        await self.get_row(room_id)
        filename, data, digest = await receive_material(incoming)
        identifier = new_id()
        path = material_path(self.principal.owner_user_id, room_id, identifier, filename)
        exclusive_write(path, data)
        try:
            await self.cas(room_id, expected)
            self.session.add(
                InterviewMaterial(
                    id=identifier,
                    room_id=room_id,
                    filename=filename,
                    sha256=digest,
                    size=len(data),
                )
            )
            await self.session.commit()
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return await self.get(room_id)

    async def material(self, room_id, material_id):
        await self.get_row(room_id)
        row = await self.session.scalar(
            select(InterviewMaterial).where(
                InterviewMaterial.room_id == room_id,
                InterviewMaterial.id == material_id,
            )
        )
        if row is None:
            raise OperationError("材料不存在", "not_found", 404)
        return material_path(
            self.principal.owner_user_id, room_id, row.id, row.filename
        ), row.filename

    async def prepare(self, room_id, body):
        room = await self.get_row(room_id)
        previous = await self.session.scalar(
            select(InterviewPreparation).where(
                InterviewPreparation.room_id == room_id,
                InterviewPreparation.request_id == body.request_id,
            )
        )
        if previous:
            if previous.fingerprint != fingerprint(body):
                raise OperationError(
                    "同一 request_id 不能用于不同操作", "idempotency_conflict", 409
                )
            return await self.get(room_id)
        if not body.resume.strip() and not body.material_id:
            raise OperationError("请上传简历原件或填写简历内容")
        if room.active_task_id:
            current = await self.session.get(InterviewPreparation, room.active_task_id)
            if current and current.status in ACTIVE:
                raise OperationError("请先取消当前准备任务", "task_active", 409)
        material = None
        if body.material_id:
            await self.material(room_id, body.material_id)
            row = await self.session.get(InterviewMaterial, body.material_id)
            material = {"id": row.id, "filename": row.filename, "sha256": row.sha256}
        snapshot = {
            "role": body.role,
            "jd": body.jd,
            "resume": body.resume.strip(),
            "duration": body.duration,
            "material": material,
        }
        digest = hashlib.sha256(
            json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()
        identifier = new_id()
        version = room.input_version + 1
        await self.cas(
            room_id,
            body.expected_revision,
            title=body.role,
            input_version=version,
            active_task_id=identifier,
        )
        self.session.add(
            InterviewPreparation(
                id=identifier,
                owner_user_id=self.principal.owner_user_id,
                user_id=self.principal.user_id,
                room_id=room_id,
                request_id=body.request_id,
                fingerprint=fingerprint(body),
                input_hash=digest,
                input_version=version,
                snapshot=snapshot,
            )
        )
        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            previous = await self.session.scalar(
                select(InterviewPreparation).where(
                    InterviewPreparation.room_id == room_id,
                    InterviewPreparation.request_id == body.request_id,
                )
            )
            if not previous or previous.fingerprint != fingerprint(body):
                raise
        return await self.get(room_id)

    async def task(self, room_id, task_id):
        await self.get_row(room_id)
        row = await self.session.scalar(
            select(InterviewPreparation).where(
                InterviewPreparation.id == task_id,
                InterviewPreparation.room_id == room_id,
            )
        )
        if row is None:
            raise OperationError("准备任务不存在", "not_found", 404)
        return row

    async def cancel(self, room_id, task_id, expected):
        row = await self.task(room_id, task_id)
        message = "已取消，尚未启动 Codex" if row.status == "queued" else "已取消，正在停止任务进程"
        result = await self.session.execute(
            update(InterviewPreparation)
            .where(
                InterviewPreparation.id == row.id,
                InterviewPreparation.revision == expected,
                InterviewPreparation.status.in_(ACTIVE),
            )
            .values(
                status="cancelled",
                revision=InterviewPreparation.revision + 1,
                message=message,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = task_out(await self.task(room_id, task_id))
            raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))
        await self.session.commit()
        return await self.get(room_id)

    async def delete(self, room_id, expected):
        await self.get_row(room_id)
        await self.cas(room_id, expected)
        await self.session.execute(delete(InterviewRoom).where(InterviewRoom.id == room_id))
        await self.session.commit()
        root = room_root(self.principal.owner_user_id, room_id)
        if root.exists():
            shutil.rmtree(root)

    async def bundle(self, room_id, task_id):
        task = await self.task(room_id, task_id)
        if task.result is None:
            raise OperationError("资料尚未交付", "not_found", 404)
        return task.result

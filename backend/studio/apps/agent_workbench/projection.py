"""Record native frames together with the corresponding workbench checkpoint."""

import hashlib
from dataclasses import dataclass

from fastapi import HTTPException
from pydantic import TypeAdapter, ValidationError

from studio.apps.agent_workbench.storage.service_models import (
    NativeProjectionReceipt,
    NativeSubscription,
)
from studio.apps.agent_workbench.sync.projection import apply_batch
from studio.contracts.agent_workbench.session_history import ReadBatch
from studio.runtime.tasks.native_queue import digest

BATCH = TypeAdapter(ReadBatch)


@dataclass(frozen=True)
class FrameReceipt:
    context: dict
    job_id: str
    locator: str
    frame_id: str
    checksum: str

    @property
    def key(self):
        return self.context["id"], hashlib.sha256(self.locator.encode()).hexdigest()

    async def active_subscription(self, session):
        current = await session.get(NativeSubscription, self.context["id"])
        if current is None or current.current_job_id != self.job_id:
            raise HTTPException(410, "native_subscription_changed")

    async def already_recorded(self, session):
        await self.active_subscription(session)
        row = await session.get(NativeProjectionReceipt, self.key)
        if row and row.frame_id == self.frame_id:
            if row.payload_sha256 != self.checksum:
                raise HTTPException(409, "native_frame_conflict")
            return True
        return False

    async def record(self, session):
        await self.active_subscription(session)
        row = await session.get(NativeProjectionReceipt, self.key)
        if row is None:
            row = NativeProjectionReceipt(
                source_id=self.key[0],
                locator_sha256=self.key[1],
                owner_user_id=self.context["owner"],
            )
            session.add(row)
        row.source_revision = self.context["revision"]
        row.frame_id = self.frame_id
        row.payload_sha256 = self.checksum


async def project_frame(database, context, *, lease, frame_id, locator, expected, value):
    try:
        batch = BATCH.validate_python(value)
        if len(batch.entries) > 10000:
            raise ValueError("native_batch_too_large")
        for entry in batch.entries:
            for attachment in entry.attachments:
                if not all(
                    isinstance(attachment.get(key), str) for key in ("id", "name", "reference")
                ):
                    raise ValueError("native_attachment_invalid")
    except (ValidationError, ValueError) as exc:
        raise HTTPException(422, "native_batch_invalid") from exc
    checksum = digest({"locator": locator, "expected": expected, "batch": value})
    receipt = FrameReceipt(context, str(lease.job_id), locator, str(frame_id), checksum)
    return await apply_batch(
        database.sessions,
        context["id"],
        context["owner"],
        context["revision"],
        locator,
        expected,
        batch,
        receipt=receipt,
    )

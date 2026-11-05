"""Bind a source task to one archive and expose its durable Video project receipt."""

from uuid import uuid4

from sqlalchemy import select, text

from app.capabilities.asset_store.project_snapshots import ProjectSnapshotError
from studio.apps.video_editor.storage.service_models import VideoImportBatch
from studio.contracts.galgame_workshop.galgame_handoff import (
    VideoHandoffReceipt,
    handoff_source_digest,
)

ACTIVE = {"staging", "commit", "published"}


async def exact_batch(session, exact, digest):
    rows = list(
        await session.scalars(
            select(VideoImportBatch)
            .where(
                VideoImportBatch.source_sha256 == exact,
                VideoImportBatch.handoff_archive_sha256.is_not(None),
            )
            .order_by(VideoImportBatch.updated_at.desc())
        )
    )
    if any(row.handoff_archive_sha256 != digest for row in rows):
        raise ProjectSnapshotError(
            "同一剪辑交接任务已绑定不同归档", code="galgame_handoff_digest_conflict", status=409
        )
    return next((row for row in rows if row.state in ACTIVE), None)


async def reserve_handoff(session, owner, project, task, digest):
    exact = handoff_source_digest(project, task)
    await session.rollback()
    await session.execute(text("BEGIN IMMEDIATE"))
    row = await exact_batch(session, exact, digest)
    if row is not None:
        identity, state = row.batch_id, row.state
        await session.rollback()
        return identity, state, exact
    identity = uuid4().hex
    session.add(
        VideoImportBatch(
            owner_user_id=owner,
            batch_id=identity,
            source_sha256=exact,
            handoff_archive_sha256=digest,
        )
    )
    await session.commit()
    return identity, None, exact


async def handoff_status(session, project, task, digest):
    row = await exact_batch(session, handoff_source_digest(project, task), digest)
    if row is None:
        return None
    if row.state != "published":
        return VideoHandoffReceipt(state="pending")
    return VideoHandoffReceipt(state="published", project_id=row.result["project"]["id"])

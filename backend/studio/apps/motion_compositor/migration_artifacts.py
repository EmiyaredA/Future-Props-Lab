"""Export historical Motion output bytes from the sealed compatibility layout."""

import asyncio
from functools import partial

from fastapi import HTTPException
from sqlalchemy import func, select

from studio.apps.motion_compositor.storage.models import MotionTask
from studio.contracts.management.editing_artifacts import (
    MAX_ARTIFACT_BYTES,
    MOTION_DATASET,
    MOTION_PREFIX,
    MotionRenderBatch,
    MotionRenderHistory,
    MotionRenderPage,
    RenderArtifact,
)
from studio.contracts.media_rendering.output_formats import OUTPUT_NAMES
from studio.runtime.database.artifact_migration_source import artifact_page, mount_artifact_source
from studio.runtime.files.migration_files import checked_path, inspect_blob, inventory_directory


def invalid():
    return HTTPException(409, {"code": "migration_motion_output_conflict"})


def scope(owner, project, task):
    return (
        "accounts",
        owner,
        "applications",
        "motion-compositor",
        "projects",
        project,
        "exports",
        task,
    )


def locate(root, owner, row, key):
    name = OUTPUT_NAMES.get(key)
    if name is None or row.outputs.get(key) != name:
        raise ValueError("历史特效导出名称无效")
    return checked_path(root, *scope(owner, row.project_id, row.id), name)


def measure(root, owner, row):
    files = []
    for key in sorted(row.outputs):
        path = locate(root, owner, row, key)
        size, digest = inspect_blob(path, maximum=MAX_ARTIFACT_BYTES)
        files.append(RenderArtifact(key=key, filename=path.name, size=size, sha256=digest))
    return MotionRenderHistory(
        id=row.id, project_id=row.project_id, created_at=row.created_at, files=tuple(files)
    )


def check_inventory(root, owners, rows):
    expected = {locate(root, row.owner_user_id, row, key) for row in rows for key in row.outputs}
    found = set()
    for owner in inventory_directory(checked_path(root, "accounts")):
        base = checked_path(root, "accounts", owner.name, "applications", "motion-compositor")
        if owner.name not in owners and base.exists():
            raise ValueError("特效输出账号未登记")
        for project in inventory_directory(base / "projects"):
            exports = checked_path(
                root,
                "accounts",
                owner.name,
                "applications",
                "motion-compositor",
                "projects",
                project.name,
                "exports",
            )
            for task in inventory_directory(exports):
                for path in inventory_directory(task):
                    if path.is_symlink() or not path.is_file():
                        raise ValueError("特效导出存在未知文件")
                    found.add(path)
    if expected != found:
        raise ValueError("特效导出存在遗漏或未知文件")


async def inventory(sessions, plan, root):
    async with sessions() as session:
        active = await session.scalar(
            select(func.count())
            .select_from(MotionTask)
            .where(MotionTask.status.in_(("queued", "running")))
        )
        if active:
            raise HTTPException(409, {"code": "migration_motion_tasks_pending"})
        rows = list(
            await session.scalars(select(MotionTask).where(MotionTask.status == "completed"))
        )
    owners = {str(owner) for owner in plan.owner_ids}
    try:
        if {row.owner_user_id for row in rows} - owners:
            raise ValueError("特效任务账号未登记")
        await asyncio.to_thread(check_inventory, root, owners, rows)
    except (OSError, ValueError):
        raise invalid() from None
    return {"record_count": len(rows)}


async def page(sessions, plan, root, owner_id, after):
    owner = str(owner_id)
    async with sessions() as session:
        rows = list(
            await session.scalars(
                select(MotionTask)
                .where(
                    MotionTask.owner_user_id == owner,
                    MotionTask.status == "completed",
                    MotionTask.id > (after or ""),
                )
                .order_by(MotionTask.id)
                .limit(2)
            )
        )
    try:
        records = (await asyncio.to_thread(measure, root, owner, rows[0]),) if rows else ()
    except (OSError, ValueError):
        raise invalid() from None
    return artifact_page(
        plan,
        owner_id,
        after,
        MOTION_DATASET,
        MotionRenderBatch,
        MotionRenderPage,
        records,
        more=len(rows) == 2,
    )


async def resolve(sessions, root, owner, identity, key):
    async with sessions() as session:
        row = await session.scalar(
            select(MotionTask).where(
                MotionTask.id == identity,
                MotionTask.owner_user_id == owner,
                MotionTask.status == "completed",
            )
        )
    if row is None:
        raise ValueError("历史特效任务不存在")
    return locate(root, owner, row, key)


def mount_motion_artifacts(app, plan, sessions, source):
    root = source.path.parent
    mount_artifact_source(
        app,
        plan,
        source,
        prefix=MOTION_PREFIX,
        batch=MotionRenderBatch,
        page_model=MotionRenderPage,
        inventory=partial(inventory, sessions, plan, root),
        page=partial(page, sessions, plan, root),
        resolve=partial(resolve, sessions, root),
        invalid_code="migration_motion_output_conflict",
    )

"""Export exact compatibility-site proxy, thumbnail and waveform files."""

import asyncio
import re
from functools import partial

from fastapi import HTTPException
from sqlalchemy import func, or_, select

from studio.apps.video_editor.storage.models import (
    VideoEditorAssetMetadata,
    VideoEditorProject,
    VideoEditorTask,
)
from studio.contracts.management.editing_artifacts import (
    MAX_ARTIFACT_BYTES,
    VIDEO_DATASET,
    VIDEO_PREFIX,
    RenderArtifact,
    VideoDerivativeBatch,
    VideoDerivativeHistory,
    VideoDerivativePage,
)
from studio.runtime.database.artifact_migration_source import artifact_page, mount_artifact_source
from studio.runtime.files.migration_files import checked_path, inspect_blob, inventory_directory

VARIANTS = ("proxy", "thumbnail", "waveform")
FRAME_CACHE = re.compile(
    r"frame-(?:v[0-9]+-(?:composite[0-9]+-)?(?:chroma[0-9]+-(?:sample[0-9]+-)?)?)?"
    r"r[0-9]+-t[0-9]+-w[0-9]+(?:-raw(?:none|[a-f0-9]{16}))?\.png"
)
MEDIA_CACHE = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}-(thumbnail\.png|proxy\.mp4)")


def invalid():
    return HTTPException(409, {"code": "migration_video_derivative_conflict"})


def query():
    media = VideoEditorAssetMetadata
    return (
        select(media, VideoEditorProject.owner_user_id)
        .outerjoin(VideoEditorProject, VideoEditorProject.id == media.project_id)
        .where(or_(*(getattr(media, f"{key}_filename").is_not(None) for key in VARIANTS)))
    )


def locate(root, owner, row, key):
    filename = getattr(row, f"{key}_filename", None) if key in VARIANTS else None
    if not filename:
        raise ValueError("历史剪辑派生文件不存在")
    return checked_path(
        root,
        "accounts",
        owner,
        "applications",
        "video-editor",
        "projects",
        row.project_id,
        "derived",
        filename,
    )


def measure(root, owner, row):
    files = []
    for key in VARIANTS:
        if getattr(row, f"{key}_filename") is None:
            continue
        path = locate(root, owner, row, key)
        size, digest = inspect_blob(path, maximum=MAX_ARTIFACT_BYTES)
        files.append(RenderArtifact(key=key, filename=path.name, size=size, sha256=digest))
    return VideoDerivativeHistory(
        id=row.asset_id,
        project_id=row.project_id,
        created_at=row.created_at,
        source_sha256=row.fingerprint,
        probe=row.probe,
        files=tuple(files),
    )


def is_preview_cache(path):
    if not (FRAME_CACHE.fullmatch(path.name) or MEDIA_CACHE.fullmatch(path.name)):
        return False
    with path.open("rb") as source:
        signature = source.read(12)
    if path.suffix == ".png":
        return signature.startswith(b"\x89PNG\r\n\x1a\n")
    return signature[4:8] == b"ftyp"


def check_inventory(root, owners, rows):
    expected = {
        locate(root, owner, row, key)
        for row, owner in rows
        for key in VARIANTS
        if getattr(row, f"{key}_filename") is not None
    }
    found = set()
    for owner in inventory_directory(checked_path(root, "accounts")):
        base = checked_path(root, "accounts", owner.name, "applications", "video-editor")
        if owner.name not in owners and base.exists():
            raise ValueError("剪辑派生文件账号未登记")
        for project in inventory_directory(base / "projects"):
            derived = checked_path(
                root,
                "accounts",
                owner.name,
                "applications",
                "video-editor",
                "projects",
                project.name,
                "derived",
            )
            for path in inventory_directory(derived):
                if path.is_symlink() or not path.is_file():
                    raise ValueError("剪辑派生目录存在未知文件")
                if path not in expected and is_preview_cache(path):
                    continue
                found.add(path)
    if found != expected:
        raise ValueError("剪辑派生文件存在遗漏或未登记内容")


async def inventory(sessions, plan, root):
    async with sessions() as session:
        active = await session.scalar(
            select(func.count())
            .select_from(VideoEditorTask)
            .where(
                VideoEditorTask.kind != "media", VideoEditorTask.status.in_(("queued", "running"))
            )
        )
        if active:
            raise HTTPException(409, {"code": "migration_video_tasks_pending"})
        rows = (await session.execute(query())).all()
    owners = {str(owner) for owner in plan.owner_ids}
    try:
        if {owner for _row, owner in rows} - owners:
            raise ValueError("剪辑派生文件账号未登记")
        await asyncio.to_thread(check_inventory, root, owners, rows)
    except (OSError, ValueError):
        raise invalid() from None
    return {"record_count": len(rows)}


async def page(sessions, plan, root, owner_id, after):
    owner = str(owner_id)
    key = VideoEditorAssetMetadata.asset_id
    async with sessions() as session:
        rows = list(
            (
                await session.execute(
                    query()
                    .where(VideoEditorProject.owner_user_id == owner, key > (after or ""))
                    .order_by(key)
                    .limit(2)
                )
            ).scalars()
        )
    try:
        records = (await asyncio.to_thread(measure, root, owner, rows[0]),) if rows else ()
    except (OSError, ValueError):
        raise invalid() from None
    return artifact_page(
        plan,
        owner_id,
        after,
        VIDEO_DATASET,
        VideoDerivativeBatch,
        VideoDerivativePage,
        records,
        more=len(rows) == 2,
    )


async def resolve(sessions, root, owner, identity, key):
    async with sessions() as session:
        row = (
            (
                await session.execute(
                    query().where(
                        VideoEditorProject.owner_user_id == owner,
                        VideoEditorAssetMetadata.asset_id == identity,
                    )
                )
            )
            .scalars()
            .one_or_none()
        )
    if row is None:
        raise ValueError("历史剪辑派生文件不存在")
    return locate(root, owner, row, key)


def mount_video_artifacts(app, plan, sessions, source):
    root = source.path.parent
    mount_artifact_source(
        app,
        plan,
        source,
        prefix=VIDEO_PREFIX,
        batch=VideoDerivativeBatch,
        page_model=VideoDerivativePage,
        inventory=partial(inventory, sessions, plan, root),
        page=partial(page, sessions, plan, root),
        resolve=partial(resolve, sessions, root),
        invalid_code="migration_video_derivative_conflict",
    )

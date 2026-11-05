from __future__ import annotations

from collections.abc import AsyncIterator, Iterable
from contextlib import asynccontextmanager
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from studio.runtime.files.directory_staging import StagedDirectory
from studio.runtime.files.project_layout import ProjectCreationLayout, ProjectDeletionLayout

RESTORE_ATTEMPTS = 2


def _restore_staged_root(
    storage: ProjectDeletionLayout,
    staged: StagedDirectory | None,
) -> None:
    last_error: OSError | None = None
    for _ in range(RESTORE_ATTEMPTS):
        try:
            storage.restore_staged_root(staged)
            return
        except OSError as error:
            last_error = error
    if last_error is not None:
        raise last_error


@asynccontextmanager
async def creating_project_layout(
    session: AsyncSession,
    storage: ProjectCreationLayout,
    application_id: str,
    project_id: str,
    *,
    owner_user_id: str,
) -> AsyncIterator[None]:
    """Commit a new project and compensate a newly created file root on failure."""
    created_root = storage.ensure_project_layout(
        application_id, project_id, owner_user_id=owner_user_id
    )
    try:
        yield
        await session.commit()
    except BaseException:
        await session.rollback()
        if created_root:
            storage.remove_project_root(application_id, project_id, owner_user_id=owner_user_id)
        raise


@asynccontextmanager
async def importing_project_layout(
    session: AsyncSession,
    storage: ProjectCreationLayout,
    application_id: str,
    project_id: str,
    *,
    owner_user_id: str,
) -> AsyncIterator[None]:
    """以持久标记暂存导入项目，让启动补偿能识别中断状态。"""
    created_root = storage.ensure_project_layout(
        application_id, project_id, owner_user_id=owner_user_id
    )
    root = storage.project_root(application_id, project_id, owner_user_id=owner_user_id)
    marker = root / ".snapshot-importing"
    try:
        marker.write_text("1", encoding="ascii")
    except BaseException:
        if created_root:
            storage.remove_project_root(application_id, project_id, owner_user_id=owner_user_id)
        raise
    try:
        yield
        await session.commit()
    except BaseException:
        await session.rollback()
        if created_root:
            storage.remove_project_root(application_id, project_id, owner_user_id=owner_user_id)
        raise
    try:
        marker.unlink(missing_ok=True)
    except OSError:
        # 数据库与项目目录已经提交；遗留标记由下次启动补偿清理。
        pass


@asynccontextmanager
async def deleting_project_layout(
    session: AsyncSession,
    storage: ProjectDeletionLayout,
    application_id: str,
    project_id: str,
    *,
    owner_user_id: str,
    legacy_paths: Iterable[Path] = (),
) -> AsyncIterator[None]:
    """Stage project files until the matching database delete is committed."""
    staged = storage.stage_project_root(application_id, project_id, owner_user_id=owner_user_id)
    try:
        yield
        await session.commit()
    except BaseException:
        await session.rollback()
        _restore_staged_root(storage, staged)
        raise
    for path in legacy_paths:
        path.unlink(missing_ok=True)
    storage.purge_staged_root(staged)

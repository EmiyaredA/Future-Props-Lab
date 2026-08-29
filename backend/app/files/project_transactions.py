from __future__ import annotations

from collections.abc import AsyncIterator, Iterable
from contextlib import asynccontextmanager
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.files.storage import AssetStorage, StagedProjectRoot

RESTORE_ATTEMPTS = 2


def _restore_staged_root(
    storage: AssetStorage,
    staged: StagedProjectRoot | None,
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
    storage: AssetStorage,
    application_id: str,
    project_id: str,
    *,
    workspace_id: str,
) -> AsyncIterator[None]:
    """Commit a new project and compensate a newly created file root on failure."""
    created_root = storage.ensure_project_layout(
        application_id, project_id, workspace_id=workspace_id
    )
    try:
        yield
        await session.commit()
    except BaseException:
        await session.rollback()
        if created_root:
            storage.remove_project_root(application_id, project_id, workspace_id=workspace_id)
        raise


@asynccontextmanager
async def deleting_project_layout(
    session: AsyncSession,
    storage: AssetStorage,
    application_id: str,
    project_id: str,
    *,
    workspace_id: str,
    legacy_paths: Iterable[Path] = (),
) -> AsyncIterator[None]:
    """Stage project files until the matching database delete is committed."""
    staged = storage.stage_project_root(application_id, project_id, workspace_id=workspace_id)
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

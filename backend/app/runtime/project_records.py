from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.runtime.revisions import RevisionSnapshot, require_revision_write

ProjectRow = TypeVar("ProjectRow")


async def load_owned_project(
    session: AsyncSession,
    model: type[ProjectRow],
    project_id: str,
    owner_user_id: str,
    *,
    not_found: Callable[[], Exception],
) -> ProjectRow:
    """Load a root project with an explicit tenant predicate."""

    row = (
        await session.execute(
            select(model).where(
                model.id == project_id,
                model.owner_user_id == owner_user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise not_found()
    return row


async def patch_revisioned_project(
    session: AsyncSession,
    model: type[Any],
    project_id: str,
    owner_user_id: str,
    *,
    expected_revision: int,
    values: dict[str, object],
    load_current: Callable[[], Awaitable[RevisionSnapshot]],
) -> None:
    """Apply a project CAS update without owning the transaction boundary."""

    result = await session.execute(
        update(model)
        .where(
            model.id == project_id,
            model.owner_user_id == owner_user_id,
            model.revision == expected_revision,
        )
        .values(**values)
    )
    await require_revision_write(
        session,
        result,
        expected=expected_revision,
        load_current=load_current,
    )


async def delete_revisioned_project(
    session: AsyncSession,
    model: type[Any],
    project_id: str,
    owner_user_id: str,
    *,
    expected_revision: int,
    load_current: Callable[[], Awaitable[RevisionSnapshot]],
) -> None:
    """Apply a project CAS delete without committing or managing project files."""

    result = await session.execute(
        delete(model).where(
            model.id == project_id,
            model.owner_user_id == owner_user_id,
            model.revision == expected_revision,
        )
    )
    await require_revision_write(
        session,
        result,
        expected=expected_revision,
        load_current=load_current,
    )

"""Local directory discovery and account-owned project references."""

import asyncio
import os
import time
from dataclasses import dataclass, replace
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select, text

from app.runtime.config import REPO_ROOT, get_cloud_settings
from app.runtime.ids import new_id
from app.runtime.safe_paths import directory_fd, directory_identity, visible

from .models import WorkbenchProject
from .project_paths import validate_project_root
from .schemas import DirectoryChoice, DirectoryListing, ProjectChoice, RecentProject

RECENT_LIMIT = 20


@dataclass(frozen=True)
class CommandPreset:
    label: str
    argv: tuple[str, ...]
    executables: tuple[str, ...]
    runtime_roots: tuple[str, ...]


@dataclass(frozen=True)
class AuthorizedProject:
    identity: str
    root: str
    label: str
    presets: tuple[tuple[str, CommandPreset], ...] = ()
    source: str = "configured"
    directory_key: tuple[int, int] | None = None

    @property
    def commands(self) -> dict[str, CommandPreset]:
        return dict(self.presets)

    def matches_binding(self, current: "AuthorizedProject") -> bool:
        return current == replace(self, directory_key=None)


def label_for(root):
    return Path(root).name[:80]


def anchors():
    home = Path.home().resolve()
    return {
        home / "Projects": "项目",
        home / "Desktop": "桌面",
        home / "Documents": "文稿",
        home / "Downloads": "下载",
    }


def browse(parent, settings):
    roots = anchors()
    if parent is None:
        items = []
        for root, label in roots.items():
            try:
                with directory_fd(root):
                    items.append(DirectoryChoice(root=str(root), label=label))
            except OSError:
                continue
        return DirectoryListing(parent=None, selectable=False, items=items)

    folder = Path(parent)
    anchor = next((root for root in roots if folder.is_relative_to(root)), None)
    if anchor is None:
        raise HTTPException(409, "此目录无法浏览，请直接粘贴项目绝对路径")
    selectable = folder != anchor
    if selectable:
        validate_project_root(folder, settings)
    try:
        with directory_fd(folder) as fd, os.scandir(fd) as entries:
            children = sorted(
                (
                    entry.name
                    for entry in entries
                    if visible(entry.name) and entry.is_dir(follow_symlinks=False)
                ),
                key=lambda name: (name.casefold(), name),
            )
    except OSError:
        raise HTTPException(409, "无法读取此目录，请返回上一级或粘贴其他路径") from None
    items = [
        DirectoryChoice(root=str(root), label=label_for(root))
        for name in children
        if (root := valid_root(folder / name, settings)) is not None
    ]
    return DirectoryListing(
        parent=str(folder.parent) if selectable else None,
        selectable=selectable,
        items=items,
    )


def valid_root(root, settings):
    try:
        return validate_project_root(root, settings)
    except HTTPException:
        return None


def suggestions(settings):
    repo = valid_root(REPO_ROOT, settings)
    items = [DirectoryChoice(root=str(repo), label=label_for(repo))] if repo else []
    try:
        children = browse(str(Path.home().resolve() / "Projects"), settings).items
    except HTTPException:
        children = []
    items.extend(item for item in children if item.root != str(repo))
    return items


async def recent(db, owner, settings):
    rows = (
        await db.scalars(
            select(WorkbenchProject)
            .where(WorkbenchProject.owner_user_id == owner)
            .order_by(WorkbenchProject.last_used_at.desc(), WorkbenchProject.id)
            .limit(RECENT_LIMIT)
        )
    ).all()
    choices = [RecentProject(id=row.id, label=label_for(row.root), root=row.root) for row in rows]
    await db.rollback()
    return await asyncio.to_thread(
        lambda: [choice for choice in choices if valid_root(choice.root, settings)]
    )


async def register(db, owner, root):
    settings = get_cloud_settings()
    root = str(await asyncio.to_thread(validate_project_root, root, settings))
    return await register_verified(db, owner, root)


async def register_verified(db, owner, root):
    await db.rollback()
    await db.execute(text("BEGIN IMMEDIATE"))
    row = await db.scalar(
        select(WorkbenchProject).where(
            WorkbenchProject.owner_user_id == owner, WorkbenchProject.root == root
        )
    )
    timestamp = time.time_ns()
    if row is None:
        row = WorkbenchProject(
            id=f"local-{new_id()}", owner_user_id=owner, root=root, last_used_at=timestamp
        )
        db.add(row)
    else:
        row.last_used_at = timestamp
    identity = row.id
    await db.commit()
    return ProjectChoice(id=identity, label=label_for(root))


async def touch(db, owner, identity):
    row = await db.scalar(
        select(WorkbenchProject).where(
            WorkbenchProject.id == identity, WorkbenchProject.owner_user_id == owner
        )
    )
    if row is not None:
        row.last_used_at = time.time_ns()


async def binding(db, identity, owner, *, local, settings=None):
    """Resolve authorization and immutable configuration without filesystem access."""
    settings = settings or get_cloud_settings()
    if local:
        row = await db.scalar(
            select(WorkbenchProject).where(
                WorkbenchProject.id == identity, WorkbenchProject.owner_user_id == owner
            )
        )
        if row is not None:
            return AuthorizedProject(identity, row.root, label_for(row.root), source="local")
    return configured_binding(identity, owner, settings)


def configured_binding(identity, owner, settings):
    project = settings.fpl_cloud_control_projects.get(identity)
    if project is None or owner not in project.user_ids:
        raise HTTPException(404, "项目不可用")
    presets = tuple(
        (
            key,
            CommandPreset(
                command.label,
                tuple(command.argv),
                tuple(command.executables),
                tuple(command.runtime_roots),
            ),
        )
        for key, command in sorted(project.commands.items())
    )
    return AuthorizedProject(identity, project.root, project.label, presets)


async def check_root(project, settings=None):
    return await asyncio.to_thread(
        check_project_directory, project, settings or get_cloud_settings()
    )


def check_project_directory(project, settings):
    root = validate_project_root(project.root, settings)
    try:
        with directory_fd(root) as fd:
            return replace(project, directory_key=directory_identity(fd))
    except OSError:
        raise HTTPException(409, "项目目录不可用") from None


async def registered_labels(db, owner, identities):
    rows = await db.execute(
        select(WorkbenchProject.id, WorkbenchProject.root).where(
            WorkbenchProject.owner_user_id == owner, WorkbenchProject.id.in_(identities)
        )
    )
    return {identity: label_for(root) for identity, root in rows}


async def labels(db, owner, identities):
    result = await registered_labels(db, owner, identities)
    legacy = get_cloud_settings().fpl_cloud_control_projects
    for identity in identities - result.keys():
        project = legacy.get(identity)
        if project is not None and owner in project.user_ids:
            result[identity] = project.label
    return result

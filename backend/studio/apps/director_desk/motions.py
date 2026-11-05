"""account user-motion library. Bytes stay in the library directory."""

from __future__ import annotations

import re

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.director_desk.files import DirectorDeskFiles
from studio.apps.director_desk.projects import DirectorDeskError
from studio.apps.director_desk.schemas import (
    DirectorMotionList,
    DirectorMotionOut,
    DirectorMotionWrite,
)
from studio.apps.director_desk.storage.models import DirectorDeskUserMotion
from studio.runtime.time import utc_now

MOTION_KEY = re.compile(r"^user-motion:model-[a-f0-9]{64}:[0-9]+$")


def file_keys(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        key = value.get("file")
        if isinstance(key, str):
            found.add(key)
        for item in value.values():
            found.update(file_keys(item))
    elif isinstance(value, list):
        for item in value:
            found.update(file_keys(item))
    return found


class DirectorDeskMotions:
    def __init__(
        self, session: AsyncSession, owner_user_id: str, *, storage: AssetStorage | None = None
    ):
        self.session = session
        self.owner_user_id = owner_user_id
        self.files = DirectorDeskFiles(session, owner_user_id, storage=storage)

    async def list(self, query: str) -> DirectorMotionList:
        filters = [DirectorDeskUserMotion.owner_user_id == self.owner_user_id]
        if query.strip():
            filters.append(DirectorDeskUserMotion.name.contains(query.strip(), autoescape=True))
        rows = (
            await self.session.execute(
                select(DirectorDeskUserMotion.motion)
                .where(*filters)
                .order_by(DirectorDeskUserMotion.name, DirectorDeskUserMotion.motion_key)
            )
        ).scalars()
        return DirectorMotionList(items=list(rows))

    async def get(self, motion_key: str) -> DirectorMotionOut:
        row = await self.row(motion_key)
        return DirectorMotionOut(motion=row.motion, resource=row.resource)

    async def save(self, motion_key: str, body: DirectorMotionWrite) -> DirectorMotionOut:
        self._check_key(motion_key)
        keys = file_keys(body.resource)
        if not keys:
            raise DirectorDeskError("动作资源缺少文件", 422, "missing_file")
        name = body.motion.get("name")
        if not isinstance(name, str) or not name.strip() or len(name) > 100:
            raise DirectorDeskError("动作名称无效", 422, "invalid_motion")
        await self.session.rollback()
        await self.session.execute(text("BEGIN IMMEDIATE"))
        self.files.require_library_keys(keys)
        row = await self._find(motion_key)
        if row is None:
            row = DirectorDeskUserMotion(
                owner_user_id=self.owner_user_id,
                motion_key=motion_key,
                name=name.strip(),
                motion=body.motion,
                resource=body.resource,
            )
            self.session.add(row)
        else:
            row.name = name.strip()
            row.motion = body.motion
            row.resource = body.resource
            row.updated_at = utc_now()
        await self.session.commit()
        return DirectorMotionOut(motion=row.motion, resource=row.resource)

    async def delete(self, motion_key: str) -> None:
        await self.session.rollback()
        await self.session.execute(text("BEGIN IMMEDIATE"))
        row = await self.row(motion_key)
        keys = file_keys(row.resource)
        await self.session.delete(row)
        await self.session.commit()
        await self._drop_unused(keys)

    async def row(self, motion_key: str) -> DirectorDeskUserMotion:
        self._check_key(motion_key)
        row = await self._find(motion_key)
        if row is None:
            raise DirectorDeskError("用户动作不存在")
        return row

    async def _find(self, motion_key: str) -> DirectorDeskUserMotion | None:
        return await self.session.scalar(
            select(DirectorDeskUserMotion).where(
                DirectorDeskUserMotion.owner_user_id == self.owner_user_id,
                DirectorDeskUserMotion.motion_key == motion_key,
            )
        )

    async def _drop_unused(self, keys: set[str]) -> None:
        if not keys:
            return
        await self.session.execute(text("BEGIN IMMEDIATE"))
        rows = (
            await self.session.scalars(
                select(DirectorDeskUserMotion.resource).where(
                    DirectorDeskUserMotion.owner_user_id == self.owner_user_id
                )
            )
        ).all()
        used = set().union(*(file_keys(row) for row in rows))
        directory = self.files.library_dir()
        for key in keys - used:
            (directory / key).unlink(missing_ok=True)
        await self.session.rollback()

    @staticmethod
    def _check_key(motion_key: str) -> None:
        if MOTION_KEY.fullmatch(motion_key) is None:
            raise DirectorDeskError("动作标识无效", 422, "invalid_motion")

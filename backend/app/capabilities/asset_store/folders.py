"""Owned folder operations shared by the legacy adapter and independent Assets."""

from collections.abc import Awaitable, Callable

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.capabilities.asset_store.asset_context import VisualAssetContext
from app.capabilities.asset_store.asset_outputs import folder_out
from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAssetFolder
from app.capabilities.asset_store.schemas.files import (
    VisualAssetFolderCreateIn,
    VisualAssetFolderListOut,
    VisualAssetFolderOut,
    VisualAssetFolderPatchIn,
)
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now

MAX_FOLDER_DEPTH = 5


class AssetFolders(VisualAssetContext):
    async def list_folders(self, project_id: str | None) -> VisualAssetFolderListOut:
        if project_id:
            await self._project(project_id)
        condition = (
            VisualAssetFolder.project_id == project_id
            if project_id is not None
            else VisualAssetFolder.project_id.is_(None)
        )
        rows = (
            (
                await self.session.execute(
                    select(VisualAssetFolder)
                    .where(condition)
                    .order_by(VisualAssetFolder.name.collate("NOCASE"))
                )
            )
            .scalars()
            .all()
        )
        return VisualAssetFolderListOut(items=[folder_out(row) for row in rows])

    async def create_folder(
        self,
        body: VisualAssetFolderCreateIn,
        *,
        before_write: Callable[[str], Awaitable[None]] | None = None,
    ) -> VisualAssetFolderOut:
        project_id = body.project_id if body.scope == "project" else None
        if body.scope == "project":
            if not project_id:
                raise AssetError("项目文件夹必须指定 project_id")
            await self._project(project_id)
            if before_write is not None:
                await before_write(project_id)
        elif body.project_id is not None:
            raise AssetError("文件管理文件夹不能指定 project_id")
        parent = await self._validate_folder_scope(body.parent_id, project_id)
        if parent and await self._depth(parent) >= MAX_FOLDER_DEPTH:
            raise AssetError("文件夹最多支持五层", code="folder_depth_exceeded")
        row = VisualAssetFolder(
            owner_user_id=self.owner_user_id,
            project_id=project_id,
            parent_id=body.parent_id,
            name=body.name,
        )
        self.session.add(row)
        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise AssetError(
                "同一目录下已存在同名文件夹", code="name_conflict", status=409
            ) from None
        await self.session.refresh(row)
        return folder_out(row)

    async def _depth(self, folder: VisualAssetFolder) -> int:
        depth = 1
        parent_id = folder.parent_id
        while parent_id:
            parent = await self._folder(parent_id)
            depth += 1
            parent_id = parent.parent_id
        return depth

    async def _subtree_height(self, folder: VisualAssetFolder) -> int:
        condition = (
            VisualAssetFolder.project_id == folder.project_id
            if folder.project_id is not None
            else VisualAssetFolder.project_id.is_(None)
        )
        rows = (
            (await self.session.execute(select(VisualAssetFolder).where(condition))).scalars().all()
        )
        children: dict[str, list[str]] = {}
        for row in rows:
            if row.parent_id:
                children.setdefault(row.parent_id, []).append(row.id)

        def height(folder_id: str) -> int:
            return 1 + max(
                (height(child_id) for child_id in children.get(folder_id, [])),
                default=0,
            )

        return height(folder.id)

    async def patch_folder(
        self, folder_id: str, body: VisualAssetFolderPatchIn
    ) -> VisualAssetFolderOut:
        row = await self._folder(folder_id)
        new_parent_id = None if body.move_to_root else body.parent_id
        if body.parent_id is not None or body.move_to_root:
            parent = await self._validate_folder_scope(new_parent_id, row.project_id)
            cursor = parent
            while cursor:
                if cursor.id == row.id:
                    raise AssetError("文件夹不能移动到自身或后代中", code="folder_cycle")
                cursor = await self._folder(cursor.parent_id) if cursor.parent_id else None
            parent_depth = await self._depth(parent) if parent else 0
            if parent_depth + await self._subtree_height(row) > MAX_FOLDER_DEPTH:
                raise AssetError("文件夹最多支持五层", code="folder_depth_exceeded")
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
            "updated_at": utc_now(),
        }
        if body.name is not None:
            values["name"] = body.name
        if body.parent_id is not None or body.move_to_root:
            values["parent_id"] = new_parent_id
        try:
            result = await self.session.execute(
                update(VisualAssetFolder)
                .where(
                    VisualAssetFolder.id == folder_id,
                    VisualAssetFolder.revision == body.expected_revision,
                )
                .values(**values)
            )
            if result.rowcount != 1:
                await self.session.rollback()
                current = folder_out(await self._folder(folder_id))
                raise RevisionConflictError(
                    body.expected_revision, current.revision, current.model_dump(mode="json")
                )
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise AssetError(
                "同一目录下已存在同名文件夹", code="name_conflict", status=409
            ) from None
        return folder_out(await self._folder(folder_id))

    async def _descendant_folder_ids(self, root: VisualAssetFolder) -> set[str]:
        rows = (
            (
                await self.session.execute(
                    select(VisualAssetFolder).where(
                        VisualAssetFolder.project_id == root.project_id
                        if root.project_id is not None
                        else VisualAssetFolder.project_id.is_(None)
                    )
                )
            )
            .scalars()
            .all()
        )
        ids = {root.id}
        changed = True
        while changed:
            changed = False
            for row in rows:
                if row.parent_id in ids and row.id not in ids:
                    ids.add(row.id)
                    changed = True
        return ids

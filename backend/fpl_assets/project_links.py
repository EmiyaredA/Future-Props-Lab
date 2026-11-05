"""Project file placement and folder CAS live beside the owned file library."""

from sqlalchemy import delete, select, update

from app.capabilities.asset_store.asset_outputs import asset_out
from app.capabilities.asset_store.asset_scope import is_library_asset, is_visual_project_asset
from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.policy import display_name_without_original_extension
from app.capabilities.asset_store.schemas.files import VisualAssetListOut
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now

from .models import VisualProjectFileLink


class ProjectFileLinks:
    def __init__(self, files):
        self.files, self.session = files, files.session

    async def create(self, project_id, body):
        await self.files._project(project_id)
        await self.files.lock_project_write(project_id)
        asset = await self.files._asset(body.asset_id)
        if not is_library_asset(asset):
            raise AssetError("只能从文件管理导入文件", code="scope_mismatch")
        await self.files._validate_folder_scope(body.folder_id, project_id)
        existing = await self.session.scalar(
            select(VisualProjectFileLink).where(
                VisualProjectFileLink.project_id == project_id,
                VisualProjectFileLink.asset_id == asset.id,
            )
        )
        if existing is not None:
            return asset_out(asset, reference=existing)
        link = VisualProjectFileLink(
            owner_user_id=self.files.owner_user_id,
            project_id=project_id,
            asset_id=asset.id,
            folder_id=body.folder_id,
            display_name=display_name_without_original_extension(
                asset.display_name,
                asset.original_filename,
            ),
        )
        self.session.add(link)
        await self.session.flush()
        result = asset_out(asset, reference=link)
        await self.session.commit()
        return result

    async def _link(self, project_id, link_id):
        link = await self.session.get(VisualProjectFileLink, link_id)
        if link is None or link.project_id != project_id:
            raise AssetError("项目素材引用不存在", code="not_found", status=404)
        return link

    async def patch(self, project_id, link_id, body):
        await self.files._project(project_id)
        await self.files.lock_project_write(project_id)
        link = await self._link(project_id, link_id)
        asset = await self.files._asset(link.asset_id)
        if link.revision != body.expected_revision:
            current = asset_out(asset, reference=link)
            raise RevisionConflictError(
                body.expected_revision, link.revision, current.model_dump(mode="json")
            )
        folder_id = None if body.move_to_root else body.folder_id
        if body.folder_id is not None or body.move_to_root:
            await self.files._validate_folder_scope(folder_id, project_id)
        values = {"revision": body.expected_revision + 1, "updated_at": utc_now()}
        if body.display_name is not None:
            values["display_name"] = display_name_without_original_extension(
                body.display_name,
                asset.original_filename,
            )
        if body.folder_id is not None or body.move_to_root:
            values["folder_id"] = folder_id
        await self.session.execute(
            update(VisualProjectFileLink)
            .where(
                VisualProjectFileLink.id == link_id,
                VisualProjectFileLink.revision == body.expected_revision,
            )
            .values(**values)
        )
        await self.session.flush()
        result = asset_out(asset, reference=await self._link(project_id, link_id))
        await self.session.commit()
        return result

    async def delete(self, project_id, link_id, expected_revision):
        await self.files._project(project_id)
        await self.files.lock_project_write(project_id)
        link = await self._link(project_id, link_id)
        if link.revision != expected_revision:
            current = asset_out(await self.files._asset(link.asset_id), reference=link)
            raise RevisionConflictError(
                expected_revision, link.revision, current.model_dump(mode="json")
            )
        await self.session.execute(
            delete(VisualProjectFileLink).where(
                VisualProjectFileLink.id == link_id,
            )
        )
        await self.session.commit()

    async def import_assets(self, project_id, body):
        await self.files._project(project_id)
        if body.source_scope == "project":
            if body.source_project_id == project_id:
                raise AssetError("不能从当前项目重复导入素材", code="scope_mismatch")
            await self.files._project(body.source_project_id)
        # The library-reference branch has no file I/O inside its short write lock.
        if body.source_scope == "library":
            await self.files.lock_project_write(project_id)
        rows = list(
            (
                await self.session.scalars(
                    select(VisualAsset).where(VisualAsset.id.in_(body.asset_ids))
                )
            ).all()
        )
        by_id = {row.id: row for row in rows}
        if len(by_id) != len(body.asset_ids):
            raise AssetError("部分来源素材不存在", code="not_found", status=404)
        ordered = [by_id[identifier] for identifier in body.asset_ids]
        if body.source_scope == "project":
            if any(not is_visual_project_asset(row, body.source_project_id) for row in ordered):
                raise AssetError("素材不属于所选来源项目", code="scope_mismatch")
            return await self.files.copy_assets(ordered, project_id=project_id)
        if any(not is_library_asset(row) for row in ordered):
            raise AssetError("素材不属于公共文件库", code="scope_mismatch")
        existing = list(
            (
                await self.session.scalars(
                    select(VisualProjectFileLink).where(
                        VisualProjectFileLink.project_id == project_id,
                        VisualProjectFileLink.asset_id.in_(body.asset_ids),
                    )
                )
            ).all()
        )
        by_asset = {row.asset_id: row for row in existing}
        for asset in ordered:
            if asset.id not in by_asset:
                link = VisualProjectFileLink(
                    owner_user_id=self.files.owner_user_id,
                    project_id=project_id,
                    asset_id=asset.id,
                    display_name=display_name_without_original_extension(
                        asset.display_name,
                        asset.original_filename,
                    ),
                )
                self.session.add(link)
                by_asset[asset.id] = link
        await self.session.flush()
        result = VisualAssetListOut(
            items=[asset_out(asset, reference=by_asset[asset.id]) for asset in ordered]
        )
        await self.session.commit()
        return result

"""Account-bound metadata edits shared by both file API adapters."""

from sqlalchemy import update

from studio.apps.asset_library.storage.context import VisualAssetContext
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.projections import asset_out
from studio.apps.asset_library.storage.scope import ensure_library_managed
from studio.contracts.asset_library.files import VisualAssetOut, VisualAssetPatchIn
from studio.runtime.files.names import display_name_without_original_extension
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now


class AssetEdits(VisualAssetContext):
    async def patch_asset(self, asset_id: str, body: VisualAssetPatchIn) -> VisualAssetOut:
        row = await self._asset(asset_id)
        ensure_library_managed(row)
        new_folder_id = None if body.move_to_root else body.folder_id
        if body.folder_id is not None or body.move_to_root:
            await self._validate_folder_scope(new_folder_id, row.project_id)
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
            "updated_at": utc_now(),
        }
        if body.display_name is not None:
            values["display_name"] = display_name_without_original_extension(
                body.display_name,
                row.original_filename,
            )
        if body.folder_id is not None or body.move_to_root:
            values["folder_id"] = new_folder_id
        result = await self.session.execute(
            update(VisualAsset)
            .where(VisualAsset.id == asset_id, VisualAsset.revision == body.expected_revision)
            .values(**values)
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = asset_out(await self._asset(asset_id))
            raise RevisionConflictError(
                body.expected_revision, current.revision, current.model_dump(mode="json")
            )
        await self.session.commit()
        return asset_out(await self._asset(asset_id))

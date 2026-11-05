"""Upgrade the stored shape of a Story whose logical asset set is already retained."""

from sqlalchemy import select, text

from studio.apps.galgame_workshop.storage.models import GalgameProjectAssetReference
from studio.apps.galgame_workshop.story.migration_inventory import StoryMigrationInventory
from studio.runtime.project_errors import ProjectResourceError


class StoryMigrations(StoryMigrationInventory):
    async def verify_projection(self, pending):
        if not pending:
            return
        await self.session.execute(text("BEGIN IMMEDIATE"))
        projects = {candidate.row.project_id: candidate.normalized for candidate in pending}
        rows = await self.session.execute(
            select(
                GalgameProjectAssetReference.project_id, GalgameProjectAssetReference.asset_id
            ).where(GalgameProjectAssetReference.project_id.in_(projects))
        )
        assets = {project_id: set() for project_id in projects}
        for project_id, asset_id in rows:
            assets[project_id].add(asset_id)
        for project_id, document in projects.items():
            if (
                document is None
                or {asset.file_id for asset in document.assets} != assets[project_id]
            ):
                raise ProjectResourceError(
                    "故事素材引用尚未核验，无法升级历史格式",
                    "retention_unconfirmed",
                    503,
                )

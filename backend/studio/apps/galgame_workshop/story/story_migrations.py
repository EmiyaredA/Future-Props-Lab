"""Compatibility adapter for legacy Story imports."""

from studio.apps.galgame_workshop.schemas import GalgameStoryDocumentOut, GalgameStoryDocumentPutIn
from studio.apps.galgame_workshop.story.migration_inventory import (
    StoryMigrationInventory,
    normalize_legacy_import,
)
from studio.apps.galgame_workshop.story.migration_inventory import (
    inspect_story_migration as inspect_story_migration,
)
from studio.apps.galgame_workshop.story.story import GalgameStoryDocuments


class GalgameStoryMigrations(StoryMigrationInventory):
    async def import_legacy(
        self,
        project_id: str,
        *,
        expected_revision: int,
        document: object,
    ) -> GalgameStoryDocumentOut:
        normalized = normalize_legacy_import(document)
        return await GalgameStoryDocuments(self.session).put(
            project_id,
            GalgameStoryDocumentPutIn(
                expected_revision=expected_revision,
                document=normalized,
            ),
        )

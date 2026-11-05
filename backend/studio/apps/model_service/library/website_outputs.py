"""Explicit recovery-site output adapter; independent Models never imports it."""

from app.capabilities.asset_store.assets import VisualAssets
from studio.apps.model_service.library.inputs import LocalInput


class LegacyLibraryOutputs:
    def __init__(self, session, settings, owner):
        self.session, self.settings, self.owner = session, settings, owner

    async def save(self, _task_id, path, filename, mime_type):
        source = LocalInput(path, filename, mime_type)
        try:
            return await VisualAssets(self.session, self.settings, owner_user_id=self.owner).upload(
                source, project_id=None, folder_id=None
            )
        finally:
            await source.close()

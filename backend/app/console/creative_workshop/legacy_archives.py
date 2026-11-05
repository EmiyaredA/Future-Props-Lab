"""Recovery-site adapter for safe Skill extraction into Creative-owned staging."""

from app.console.creative_workshop.files import resolve_file
from studio.apps.integrations.clients.skill_archive import SkillArchiveStager
from studio.config.settings import get_settings


class LegacyCreativeArchives:
    def __init__(self, session):
        del session

    async def stage(self, owner: str, upload):
        root = resolve_file(owner, "creative-workshop/.staging")
        storage = SkillArchiveStager(root, get_settings())
        return await storage.stage(upload)

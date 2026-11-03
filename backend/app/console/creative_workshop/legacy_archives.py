"""Recovery-site adapter for safe Skill extraction into Creative-owned staging."""

from app.console.creative_workshop.files import resolve_file
from app.integrations.skills.archive import SkillArchiveStorage
from app.runtime.config import get_settings


class LegacyCreativeArchives:
    def __init__(self, session):
        del session

    async def stage(self, owner: str, upload):
        storage = SkillArchiveStorage(get_settings(), owner)
        storage.root = resolve_file(owner, "creative-workshop/.staging")
        return await storage.stage(upload)

"""Account-owned Skill layout and reversible file placement."""

import os
import shutil
from pathlib import Path
from uuid import uuid4

from studio.apps.integrations.clients.skill_archive import SkillArchiveStager, StagedSkillArchive
from studio.config.settings import Settings
from studio.contracts.integrations.errors import IntegrationValidationError


class SkillArchiveStorage(SkillArchiveStager):
    def __init__(self, settings: Settings, owner_user_id: str) -> None:
        if (
            not owner_user_id
            or Path(owner_user_id).name != owner_user_id
            or owner_user_id in {".", ".."}
        ):
            raise ValueError("Skill storage requires an account ID")
        root = settings.runtime_path / "accounts" / owner_user_id / "integrations" / "skills"
        super().__init__(root, settings)
        self.settings = settings

    def final_path(self, skill_id: str, version: str) -> Path:
        return (self.root / skill_id / version).resolve()

    def place(self, staged: StagedSkillArchive, skill_id: str, version: str) -> Path:
        destination = self.final_path(skill_id, version)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise IntegrationValidationError("Skill 版本目录已存在")
        os.replace(staged.directory, destination)
        return destination

    def stage_delete(self, skill_id: str) -> tuple[Path, Path] | None:
        source = (self.root / skill_id).resolve()
        if not source.exists():
            return None
        trash = self.settings.storage_trash_path / "integrations"
        trash.mkdir(parents=True, exist_ok=True)
        staged = trash / f"{skill_id}--trash--{uuid4().hex}"
        os.replace(source, staged)
        return source, staged

    @staticmethod
    def restore_delete(staged: tuple[Path, Path] | None) -> None:
        if staged and staged[1].exists():
            staged[0].parent.mkdir(parents=True, exist_ok=True)
            os.replace(staged[1], staged[0])

    @staticmethod
    def purge_delete(staged: tuple[Path, Path] | None) -> None:
        if staged:
            shutil.rmtree(staged[1], ignore_errors=True)

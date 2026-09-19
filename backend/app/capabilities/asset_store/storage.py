from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from app.runtime.config import Settings

TARGET_STORAGE_VERSION = 2


class StoredAsset(Protocol):
    workspace_id: str
    storage_key: str
    storage_version: int | None
    project_id: str | None
    galgame_project_id: str | None
    video_editor_project_id: str | None


@dataclass(frozen=True)
class StagedProjectRoot:
    original: Path
    staged: Path


class AssetStorage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @staticmethod
    def _segment(value: str) -> str:
        if not value or Path(value).name != value or value in {".", ".."}:
            raise ValueError("invalid storage path segment")
        return value

    def project_root(self, application_id: str, project_id: str, *, workspace_id: str) -> Path:
        project_id = self._segment(project_id)
        workspace_id = self._segment(workspace_id)
        if workspace_id != "default":
            root = self.settings.workspace_path(workspace_id) / "applications"
            return (root / application_id / "projects" / project_id).resolve()
        if application_id == "visual-workshop":
            return self.settings.visual_project_path(project_id)
        if application_id == "galgame-workshop":
            return self.settings.galgame_project_path(project_id)
        if application_id == "video-editor":
            return (
                self.settings.runtime_path
                / "applications"
                / "video-editor"
                / "projects"
                / project_id
            ).resolve()
        if application_id == "director-desk":
            return (
                self.settings.runtime_path
                / "applications"
                / "director-desk"
                / "projects"
                / project_id
            ).resolve()
        raise ValueError("unknown project application")

    def target_root(
        self,
        *,
        visual_project_id: str | None,
        galgame_project_id: str | None,
        video_editor_project_id: str | None = None,
        workspace_id: str,
    ) -> Path:
        owners = (visual_project_id, galgame_project_id, video_editor_project_id)
        if sum(owner is not None for owner in owners) > 1:
            raise ValueError("asset cannot belong to multiple project applications")
        if visual_project_id:
            return (
                self.project_root("visual-workshop", visual_project_id, workspace_id=workspace_id)
                / "assets"
            )
        if galgame_project_id:
            return (
                self.project_root("galgame-workshop", galgame_project_id, workspace_id=workspace_id)
                / "assets"
            )
        if video_editor_project_id:
            return (
                self.project_root(
                    "video-editor", video_editor_project_id, workspace_id=workspace_id
                )
                / "assets"
            )
        workspace_id = self._segment(workspace_id)
        if workspace_id != "default":
            return self.settings.workspace_path(workspace_id) / "library" / "assets"
        return self.settings.library_asset_path

    def target_path(
        self,
        storage_key: str,
        *,
        visual_project_id: str | None,
        galgame_project_id: str | None,
        video_editor_project_id: str | None = None,
        workspace_id: str,
    ) -> Path:
        return self.target_root(
            visual_project_id=visual_project_id,
            galgame_project_id=galgame_project_id,
            video_editor_project_id=video_editor_project_id,
            workspace_id=workspace_id,
        ) / self._segment(storage_key)

    def legacy_path(self, storage_key: str) -> Path:
        return self.settings.visual_asset_path / self._segment(storage_key)

    def path_for(self, asset: StoredAsset) -> Path:
        if (asset.storage_version or 1) >= TARGET_STORAGE_VERSION:
            return self.target_path(
                asset.storage_key,
                visual_project_id=asset.project_id,
                galgame_project_id=asset.galgame_project_id,
                video_editor_project_id=asset.video_editor_project_id,
                workspace_id=asset.workspace_id,
            )
        return self.legacy_path(asset.storage_key)

    def prepare_write(
        self,
        storage_key: str,
        *,
        visual_project_id: str | None,
        galgame_project_id: str | None,
        video_editor_project_id: str | None = None,
        workspace_id: str,
    ) -> tuple[Path, Path]:
        final_path = self.target_path(
            storage_key,
            visual_project_id=visual_project_id,
            galgame_project_id=galgame_project_id,
            video_editor_project_id=video_editor_project_id,
            workspace_id=workspace_id,
        )
        temp_dir = final_path.parent / ".tmp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        return temp_dir / f"{self._segment(storage_key)}-{uuid4().hex}.tmp", final_path

    def ensure_project_layout(
        self, application_id: str, project_id: str, *, workspace_id: str
    ) -> bool:
        root = self.project_root(application_id, project_id, workspace_id=workspace_id)
        created = not root.exists()
        directories = [root / "assets"]
        if application_id == "visual-workshop":
            directories.append(root / "generated")
        else:
            directories.extend((root / "derived", root / "exports"))
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
        return created

    def remove_project_root(
        self, application_id: str, project_id: str, *, workspace_id: str
    ) -> None:
        shutil.rmtree(
            self.project_root(application_id, project_id, workspace_id=workspace_id),
            ignore_errors=True,
        )

    def stage_project_root(
        self, application_id: str, project_id: str, *, workspace_id: str
    ) -> StagedProjectRoot | None:
        workspace_id = self._segment(workspace_id)
        original = self.project_root(application_id, project_id, workspace_id=workspace_id)
        if not original.exists():
            return None
        trash = self.settings.storage_trash_path / workspace_id / application_id
        trash.mkdir(parents=True, exist_ok=True)
        staged = trash / f"{self._segment(project_id)}--trash--{uuid4().hex}"
        os.replace(original, staged)
        return StagedProjectRoot(original=original, staged=staged)

    @staticmethod
    def restore_staged_root(staged: StagedProjectRoot | None) -> None:
        if staged is None or not staged.staged.exists():
            return
        staged.original.parent.mkdir(parents=True, exist_ok=True)
        os.replace(staged.staged, staged.original)

    @staticmethod
    def purge_staged_root(staged: StagedProjectRoot | None) -> None:
        if staged is not None:
            shutil.rmtree(staged.staged, ignore_errors=True)

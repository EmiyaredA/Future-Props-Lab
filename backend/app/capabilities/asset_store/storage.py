from __future__ import annotations

import shutil
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from studio.config.settings import Settings
from studio.runtime.files.directory_staging import (
    StagedDirectory,
    purge_directory,
    restore_directory,
    stage_directory,
)

TARGET_STORAGE_VERSION = 2


class StoredAsset(Protocol):
    owner_user_id: str
    storage_key: str
    storage_version: int | None
    project_id: str | None
    galgame_project_id: str | None
    video_editor_project_id: str | None
    motion_compositor_project_id: str | None


class AssetStorage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @staticmethod
    def _segment(value: str) -> str:
        if not value or Path(value).name != value or value in {".", ".."}:
            raise ValueError("invalid storage path segment")
        return value

    def project_root(self, application_id: str, project_id: str, *, owner_user_id: str) -> Path:
        project_id = self._segment(project_id)
        owner_user_id = self._segment(owner_user_id)
        allowed = {
            "visual-workshop",
            "galgame-workshop",
            "video-editor",
            "motion-compositor",
            "director-desk",
        }
        if application_id not in allowed:
            raise ValueError("unknown project application")
        return (
            self.settings.account_path(owner_user_id)
            / "applications"
            / application_id
            / "projects"
            / project_id
        ).resolve()

    def target_root(
        self,
        *,
        visual_project_id: str | None,
        galgame_project_id: str | None,
        video_editor_project_id: str | None = None,
        motion_compositor_project_id: str | None = None,
        owner_user_id: str,
    ) -> Path:
        owners = (
            visual_project_id,
            galgame_project_id,
            video_editor_project_id,
            motion_compositor_project_id,
        )
        if sum(owner is not None for owner in owners) > 1:
            raise ValueError("asset cannot belong to multiple project applications")
        if visual_project_id:
            return (
                self.project_root("visual-workshop", visual_project_id, owner_user_id=owner_user_id)
                / "assets"
            )
        if galgame_project_id:
            return (
                self.project_root(
                    "galgame-workshop", galgame_project_id, owner_user_id=owner_user_id
                )
                / "assets"
            )
        if video_editor_project_id:
            return (
                self.project_root(
                    "video-editor", video_editor_project_id, owner_user_id=owner_user_id
                )
                / "assets"
            )
        if motion_compositor_project_id:
            return (
                self.project_root(
                    "motion-compositor", motion_compositor_project_id, owner_user_id=owner_user_id
                )
                / "assets"
            )
        owner_user_id = self._segment(owner_user_id)
        return self.settings.account_path(owner_user_id) / "library" / "assets"

    def target_path(
        self,
        storage_key: str,
        *,
        visual_project_id: str | None,
        galgame_project_id: str | None,
        video_editor_project_id: str | None = None,
        motion_compositor_project_id: str | None = None,
        owner_user_id: str,
    ) -> Path:
        return self.target_root(
            visual_project_id=visual_project_id,
            galgame_project_id=galgame_project_id,
            video_editor_project_id=video_editor_project_id,
            motion_compositor_project_id=motion_compositor_project_id,
            owner_user_id=owner_user_id,
        ) / self._segment(storage_key)

    def legacy_path(self, storage_key: str, *, owner_user_id: str) -> Path:
        return (
            self.settings.account_path(owner_user_id) / "legacy-assets" / self._segment(storage_key)
        )

    def path_for(self, asset: StoredAsset) -> Path:
        if (asset.storage_version or 1) >= TARGET_STORAGE_VERSION:
            return self.target_path(
                asset.storage_key,
                visual_project_id=asset.project_id,
                galgame_project_id=asset.galgame_project_id,
                video_editor_project_id=asset.video_editor_project_id,
                motion_compositor_project_id=asset.motion_compositor_project_id,
                owner_user_id=asset.owner_user_id,
            )
        return self.legacy_path(asset.storage_key, owner_user_id=asset.owner_user_id)

    def prepare_write(
        self,
        storage_key: str,
        *,
        visual_project_id: str | None,
        galgame_project_id: str | None,
        video_editor_project_id: str | None = None,
        motion_compositor_project_id: str | None = None,
        owner_user_id: str,
    ) -> tuple[Path, Path]:
        final_path = self.target_path(
            storage_key,
            visual_project_id=visual_project_id,
            galgame_project_id=galgame_project_id,
            video_editor_project_id=video_editor_project_id,
            motion_compositor_project_id=motion_compositor_project_id,
            owner_user_id=owner_user_id,
        )
        temp_dir = final_path.parent / ".tmp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        return temp_dir / f"{self._segment(storage_key)}-{uuid4().hex}.tmp", final_path

    def ensure_project_layout(
        self, application_id: str, project_id: str, *, owner_user_id: str
    ) -> bool:
        root = self.project_root(application_id, project_id, owner_user_id=owner_user_id)
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
        self, application_id: str, project_id: str, *, owner_user_id: str
    ) -> None:
        shutil.rmtree(
            self.project_root(application_id, project_id, owner_user_id=owner_user_id),
            ignore_errors=True,
        )

    def stage_project_root(
        self, application_id: str, project_id: str, *, owner_user_id: str
    ) -> StagedDirectory | None:
        owner_user_id = self._segment(owner_user_id)
        original = self.project_root(application_id, project_id, owner_user_id=owner_user_id)
        trash = self.settings.storage_trash_path / owner_user_id / application_id
        return stage_directory(original, trash, self._segment(project_id))

    restore_staged_root = staticmethod(restore_directory)
    purge_staged_root = staticmethod(purge_directory)

"""Director account files and recovery within the service state root."""

import re
from dataclasses import dataclass
from pathlib import Path

from app.capabilities.asset_store.storage import AssetStorage, StagedProjectRoot
from studio.apps.director_desk.storage.models import DirectorDeskProject

APPLICATION = "director-desk"
STAGED = re.compile(r"^([a-f0-9-]{36})--trash--[a-f0-9]{32}$")


@dataclass(frozen=True)
class DirectorStorageSettings:
    runtime_path: Path

    @property
    def storage_trash_path(self):
        return self.runtime_path / ".trash"

    def account_path(self, owner):
        if not owner or owner in {".", ".."} or Path(owner).name != owner:
            raise ValueError("账号路径无效")
        return self.checked_path("accounts", owner)

    def checked_path(self, *parts):
        path = self.runtime_path
        for part in parts:
            path = path / part
            if path.is_symlink():
                raise ValueError("导演台目录禁止符号链接")
        return path


class DirectorStorage(AssetStorage):
    def __init__(self, root):
        self.settings = DirectorStorageSettings(root)

    def project_root(self, application_id, project_id, *, owner_user_id):
        if application_id != APPLICATION:
            raise ValueError("此文件根仅属于导演台")
        project = self._segment(project_id)
        owner = self._segment(owner_user_id)
        return self.settings.checked_path(
            "accounts", owner, "applications", APPLICATION, "projects", project
        )

    def stage_project_root(self, application_id, project_id, *, owner_user_id):
        self.settings.checked_path(".trash", self._segment(owner_user_id), APPLICATION)
        return super().stage_project_root(application_id, project_id, owner_user_id=owner_user_id)

    async def recover(self, sessions):
        trash = self.settings.checked_path(".trash")
        if not trash.is_dir():
            return
        for owner in trash.iterdir():
            application = self.settings.checked_path(".trash", owner.name, APPLICATION)
            if not application.is_dir():
                continue
            async with sessions(info={"owner_user_id": owner.name}) as session:
                for path in application.iterdir():
                    name = STAGED.fullmatch(path.name)
                    if name is None or path.is_symlink() or not path.is_dir():
                        raise ValueError("导演台存在未登记的暂存删除目录")
                    project_id = name[1]
                    row = await session.get(DirectorDeskProject, project_id)
                    original = self.project_root(APPLICATION, project_id, owner_user_id=owner.name)
                    staged = StagedProjectRoot(original=original, staged=path)
                    if row is None:
                        self.purge_staged_root(staged)
                    elif original.exists():
                        raise ValueError("导演台中断删除的项目目录发生冲突")
                    else:
                        self.restore_staged_root(staged)

"""Storage adapter operations needed by the database/file compensation mechanism.

This is an I/O boundary, not a business API. The caller supplies an authorized
account/project; implementations own layout rules. No database record is exposed.
"""

from pathlib import Path
from typing import Protocol

from studio.runtime.files.directory_staging import StagedDirectory


class ProjectCreationLayout(Protocol):
    def project_root(self, application_id: str, project_id: str, *, owner_user_id: str) -> Path: ...

    def ensure_project_layout(
        self, application_id: str, project_id: str, *, owner_user_id: str
    ) -> bool: ...

    def remove_project_root(
        self, application_id: str, project_id: str, *, owner_user_id: str
    ) -> None: ...


class ProjectDeletionLayout(Protocol):
    def stage_project_root(
        self, application_id: str, project_id: str, *, owner_user_id: str
    ) -> StagedDirectory | None: ...

    def restore_staged_root(self, staged: StagedDirectory | None) -> None: ...

    def purge_staged_root(self, staged: StagedDirectory | None) -> None: ...

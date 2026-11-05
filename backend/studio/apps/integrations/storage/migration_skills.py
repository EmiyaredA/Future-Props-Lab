"""Transfer Skill identities and versions with account-derived storage paths."""

from datetime import datetime
from pathlib import PurePosixPath
from typing import Literal

from pydantic import Field

from studio.apps.integrations.storage.models import SkillIntegration, SkillVersion
from studio.contracts.integrations.skill_migration import DIGEST, VERSION
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.runtime.database.project_history_migration import ProjectDataset


class Skill(HistoryRecord):
    id: Identifier
    name: str
    description: str
    default_version: str = Field(pattern=VERSION)
    latest_version: str = Field(pattern=VERSION)
    tags: list[str]
    enabled: bool
    status: str
    status_message: str
    revision: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime


class Version(HistoryRecord):
    id: Identifier
    skill_id: Identifier
    version: str = Field(pattern=VERSION)
    name: str
    description: str
    content_sha256: str = Field(pattern=DIGEST)
    file_count: int = Field(gt=0)
    expanded_bytes: int = Field(gt=0)
    created_at: datetime


class SkillBatch(MigrationBatch[Skill]):
    dataset: Literal["integrations.skills"]


class VersionBatch(MigrationBatch[Version]):
    dataset: Literal["integrations.skill-versions"]


def version_values(owner, record):
    path = PurePosixPath(
        "accounts", owner, "integrations", "skills", record.skill_id, record.version
    )
    return {**record.model_dump(), "storage_path": str(path)}


SKILLS = ProjectDataset(
    "integrations.skills",
    SkillIntegration,
    Skill,
    SkillBatch,
    MigrationPage[SkillBatch],
    page_size=16,
)
VERSIONS = ProjectDataset(
    "integrations.skill-versions",
    SkillVersion,
    Version,
    VersionBatch,
    MigrationPage[VersionBatch],
    page_size=16,
    project=SkillIntegration,
    parent_key="skill_id",
    owns_record=False,
    materialize=version_values,
)

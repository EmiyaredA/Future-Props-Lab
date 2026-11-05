"""Transfer the derived Integrations bindings for legacy Creative installs."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier

PREFIX = "/v1/migration/integrations/creative-installed-parts"
DATASET = "integrations.creative-installed-parts"
PAGE_SIZE = 16
RESOURCE_PRESENCE = "/v1/migration/integrations/resource-presence"
ResourceKind = Literal["tool_api", "mcp", "skill"]


class InstalledResource(HistoryRecord):
    release_id: Identifier
    kind: ResourceKind
    name: str = Field(min_length=1, max_length=120)
    resource_id: Identifier | Literal[""]
    state: Literal["pending_setup", "disabled"]

    @model_validator(mode="after")
    def validate_setup(self):
        if self.state == "pending_setup":
            if self.kind != "mcp" or self.resource_id:
                raise ValueError("只有待配置的 MCP 可以没有资源 ID")
        elif not self.resource_id:
            raise ValueError("已安装的能力需要资源 ID")
        return self


class InstalledPart(HistoryRecord):
    id: Identifier
    release_id: Identifier
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    description: str = Field(max_length=500)
    result: InstalledResource
    setup_fingerprint: Literal[""] = ""
    resource_present: bool | None = None
    created_at: datetime

    @model_validator(mode="after")
    def verify_release(self):
        if self.result.release_id != self.release_id:
            raise ValueError("安装记录与能力版本不一致")
        if self.result.state == "pending_setup" and self.resource_present is not None:
            raise ValueError("待配置 MCP 不需要校验已有资源")
        return self


class LegacyResourcePresence(HistoryRecord):
    run_id: UUID
    source_database_sha256: str
    owner_id: UUID
    resource_id: Identifier
    kind: ResourceKind
    present: bool


class InstalledParts(MigrationBatch[InstalledPart]):
    dataset: Literal["integrations.creative-installed-parts"]


InstalledPartsPage = MigrationPage[InstalledParts]

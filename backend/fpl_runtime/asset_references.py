"""Versioned retention messages shared by Assets and its authorized consumers."""

from types import MappingProxyType

from pydantic import BaseModel, ConfigDict, Field, field_validator

RESOURCE_KINDS = MappingProxyType(
    {
        "visual": frozenset({"project", "conversation", "acceptance", "output", "history"}),
        "thought": frozenset(
            {"note", "history", "template", "publication", "knowledge-base", "sync"}
        ),
        "galgame": frozenset({"project", "history", "export"}),
        "video": frozenset({"project", "history", "export"}),
        "motion": frozenset({"project", "history", "export"}),
        "presentation": frozenset({"project", "history", "template", "example", "export"}),
        "annotation": frozenset({"project", "history", "export"}),
        "director": frozenset({"project", "history", "export"}),
        "interview": frozenset({"project", "preparation"}),
        "creative": frozenset({"publication", "installation", "delivery"}),
        "models": frozenset({"inference", "test", "transcription"}),
        "rendering": frozenset({"job"}),
        "agent-runtime": frozenset({"run"}),
        "integrations": frozenset({"skill", "tool-api", "mcp"}),
        "amadeus": frozenset({"conversation", "run"}),
        "tools": frozenset({"download", "job"}),
    }
)


class ReferenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    resource_kind: str = Field(pattern=r"^[a-z][a-z-]{0,63}$")
    resource_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    resource_revision: int = Field(ge=0, strict=True)
    expected_revision: int = Field(ge=0, strict=True)
    asset_ids: list[str] = Field(max_length=10000)

    @field_validator("asset_ids")
    @classmethod
    def canonical_assets(cls, values):
        import re

        if len(set(values)) != len(values) or any(
            not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value) for value in values
        ):
            raise ValueError("素材 ID 无效或重复")
        return sorted(values)

    def validate_service(self, service):
        if self.resource_kind not in RESOURCE_KINDS.get(service, ()):
            raise ValueError("调用方不能管理此类素材引用")


class PrepareReferenceChange(BaseModel):
    """A source mutation retains prospective files until its local outcome is known."""

    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    resource_kind: str = Field(pattern=r"^[a-z][a-z-]{0,63}$")
    resource_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    expected_resource_revision: int = Field(ge=-1, strict=True)
    asset_ids: list[str] = Field(max_length=10000)

    @field_validator("asset_ids")
    @classmethod
    def canonical_assets(cls, values):
        return ReferenceUpdate.canonical_assets(values)

    def validate_service(self, service):
        if self.resource_kind not in RESOURCE_KINDS.get(service, ()):
            raise ValueError("调用方不能管理此类素材引用")

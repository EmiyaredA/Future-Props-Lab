"""Public CLI connection shapes, independent of probe execution and account storage."""

from pydantic import BaseModel, Field

from .definitions import AgentId


class ModelOption(BaseModel):
    id: str
    label: str


class AgentOut(BaseModel):
    id: AgentId
    name: str
    executable: str
    version: str
    enabled: bool
    available: bool
    status: str
    message: str
    models: list[ModelOption] = Field(default_factory=list)


class CatalogOut(BaseModel):
    items: list[AgentOut]
    can_enable: bool = False

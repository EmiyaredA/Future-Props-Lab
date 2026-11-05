from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

from fpl_runtime.agent_ids import AgentId as AgentId

Origin = Literal["app", "cli", "unknown"]


@dataclass
class SessionInfo:
    native_id: str = ""
    title: str = ""
    cwd: str = ""
    origins: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    model: str = ""
    parent_id: str | None = None
    archived: bool = False
    updated_at: str = ""
    turn_id: str | None = None


@dataclass
class Entry:
    native_id: str
    ordinal: int
    role: str
    kind: str
    text: str
    timestamp: str = ""
    parent_id: str | None = None
    tool_name: str = ""
    attachments: list[dict] = field(default_factory=list)
    presentation: dict = field(default_factory=dict)


@dataclass
class ReadBatch:
    info: SessionInfo
    entries: list[Entry]
    checkpoint: dict
    reset: bool = False
    complete: bool = True
    warning: str = ""


class SessionAdapter(Protocol):
    def discover(self, root: str) -> list[str]: ...

    def read_history(self, root: str, locator: str, checkpoint: dict) -> ReadBatch: ...

    def watch(self, root: str, locator: str, checkpoint: dict) -> ReadBatch:
        """Nonblocking incremental read; scheduling and cancellation belong to the caller."""
        ...

    def get_capabilities(self) -> dict[str, bool | str]: ...

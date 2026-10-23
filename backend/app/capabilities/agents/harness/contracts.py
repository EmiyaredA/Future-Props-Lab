from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class ImageInput:
    mime_type: str
    data_base64: str
    byte_size: int


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters_schema: dict[str, Any]


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AgentMessage:
    role: str
    text: str = ""
    images: tuple[ImageInput, ...] = ()
    tool_calls: tuple[ToolCall, ...] = ()
    tool_call_id: str = ""
    tool_name: str = ""


@dataclass(frozen=True)
class Usage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None

    def merged(self, other: Usage) -> Usage:
        def add(left: int | None, right: int | None) -> int | None:
            if left is None and right is None:
                return None
            return (left or 0) + (right or 0)

        return Usage(
            add(self.prompt_tokens, other.prompt_tokens),
            add(self.completion_tokens, other.completion_tokens),
            add(self.total_tokens, other.total_tokens),
        )


@dataclass(frozen=True)
class ModelTextDelta:
    text: str


@dataclass(frozen=True)
class ModelUsageUpdate:
    """Latest usage snapshot for one model turn, including incomplete turns."""

    usage: Usage


@dataclass(frozen=True)
class ModelTurnEnd:
    tool_calls: tuple[ToolCall, ...] = ()
    usage: Usage = field(default_factory=Usage)


ModelEvent = ModelTextDelta | ModelUsageUpdate | ModelTurnEnd


class ModelAdapter(Protocol):
    def stream_turn(
        self,
        *,
        system: str,
        messages: list[AgentMessage],
        tools: list[ToolSpec],
        model: str,
        temperature: float,
        max_tokens: int,
        round_index: int,
    ) -> AsyncIterator[ModelEvent]: ...

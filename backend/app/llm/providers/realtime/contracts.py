from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Protocol


class RealtimeProviderUnavailableError(RuntimeError):
    """The configured realtime provider could not establish a usable session."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "voice_provider_unavailable",
        retryable: bool = True,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True, slots=True)
class ResolvedRealtimeModel:
    id: str
    provider_id: str
    provider_name: str
    provider_kind: str
    slug: str
    label: str
    base_url: str
    api_key: str


class RealtimeVoiceBridge(Protocol):
    outbound: asyncio.Queue[dict[str, Any]]
    session_id: str

    async def start(self) -> None: ...

    def append_audio(self, audio_b64: str) -> None: ...

    def commit_input(self, turn_id: str | None) -> bool: ...

    def interrupt(self, turn_id: str | None) -> str | None: ...

    async def close(self) -> None: ...

"""Detached snapshots and atomic writes needed by the creative workflow."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from studio.apps.visual_workshop.schemas.creative_workflow import (
    CardData,
    CardOut,
    ScriptOut,
    ScriptUpdate,
)


@dataclass(frozen=True)
class CardEditContext:
    previous: CardOut | None
    parent: CardOut | None
    script: ScriptOut


@dataclass(frozen=True)
class CardWrite:
    data: CardData
    source_project_id: str | None
    media_projects: dict[str, str | None]


@dataclass(frozen=True)
class CreativeAsset:
    media_kind: str
    mime_type: str
    project_id: str | None


class CreativeAssets(Protocol):
    async def __call__(
        self, project_id: str | None, identities: set[str]
    ) -> dict[str, CreativeAsset]: ...


class CreativeRecords(Protocol):
    """Owner-bound records. Edit checks CAS and applies transform under one lock.

    Transform sees detached values; it cannot commit or retain live ORM rows.
    External asset inspection finishes before edit begins its write transaction.
    """

    async def require_project(self, project_id: str) -> None: ...
    async def script(self, project_id: str) -> ScriptOut: ...
    async def update_script(self, project_id: str, body: ScriptUpdate) -> ScriptOut: ...
    async def cards(self, project_id: str | None = None) -> list[CardOut]: ...
    async def card(self, project_id: str | None, card_id: str) -> CardOut: ...
    async def edit_card(
        self,
        project_id: str | None,
        data: CardData,
        card_id: str | None,
        transform: Callable[[CardEditContext], CardWrite],
    ) -> CardOut: ...

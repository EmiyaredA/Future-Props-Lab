"""Explicit model service boundary for Thought writing; no provider or foreign ORM imports."""

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Protocol

from fastapi import HTTPException

from studio.apps.thought_workshop.schemas.workshop import ThoughtModelOut


@dataclass(frozen=True)
class WritingModel:
    id: str
    label: str
    handle: object = field(repr=False)


class WritingModels(Protocol):
    async def list(self) -> list[ThoughtModelOut]: ...
    async def select(self, model_id: str) -> WritingModel: ...
    def events(self, prepared) -> AsyncIterator[bytes]: ...


@dataclass(frozen=True)
class WritingBindings:
    for_request: Callable[..., WritingModels]


def writing_models(request, owner_user_id):
    bindings = getattr(request.app.state, "thought_writing", None)
    if not isinstance(bindings, WritingBindings):
        raise HTTPException(503, {"code": "writing_models_unavailable"})
    return bindings.for_request(request, owner_user_id)

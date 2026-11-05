"""Request-owned library output delivery without importing Assets storage or ORM."""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from fastapi import HTTPException

from studio.contracts.asset_library.files import VisualAssetOut


class LibraryOutputs(Protocol):
    async def save(
        self, task_id: str, path: Path, filename: str, mime_type: str
    ) -> VisualAssetOut: ...


@dataclass(frozen=True)
class LibraryOutputBindings:
    for_request: Callable[..., LibraryOutputs]


def library_outputs(request, session, owner_user_id):
    if session.info.get("owner_user_id") != owner_user_id:
        raise HTTPException(403, {"code": "account_context_mismatch"})
    binding = getattr(request.app.state, "model_library_outputs", None)
    if not isinstance(binding, LibraryOutputBindings):
        raise HTTPException(503, {"code": "model_library_outputs_unavailable"})
    return binding.for_request(request, session, owner_user_id)

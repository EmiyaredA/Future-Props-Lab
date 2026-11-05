"""Owning applications provide an explicit per-request stream reauthorization check."""

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class ModelStreamAccess:
    for_request: Callable


def stream_access(request):
    binding = getattr(request.app.state, "model_stream_access", None)
    if binding is None:
        return None
    if not isinstance(binding, ModelStreamAccess):
        raise HTTPException(503, {"code": "model_stream_authorization_unavailable"})
    return binding.for_request(request)

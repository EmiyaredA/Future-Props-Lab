"""An owning application supplies provider transports explicitly, per request."""

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class ProviderTransports:
    resolve: Callable


def provider_options(connection, base_url):
    binding = getattr(connection.app.state, "model_provider_transports", None)
    if binding is None:
        if base_url.rstrip("/") == "https://fpl-mock.invalid/v1":
            raise HTTPException(503, {"code": "model_demo_unavailable"})
        return {}
    if not isinstance(binding, ProviderTransports):
        raise HTTPException(503, {"code": "model_provider_transport_unavailable"})
    transport = binding.resolve(base_url)
    return {"transport": transport} if transport is not None else {}

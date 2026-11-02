"""Explicit admission lifecycle supplied by the application's owning implementation."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class AdmissionBindings:
    acquire: Callable[..., Awaitable[str]]
    release: Callable[..., Awaitable[None]]
    attach: Callable[..., Awaitable[None]]
    admit_tasks: Callable[..., Awaitable[None]]


@dataclass(frozen=True)
class AdmissionProvider:
    for_connection: Callable[..., AdmissionBindings]


def admission_for(connection) -> AdmissionBindings:
    binding = getattr(connection.app.state, "model_admission", None)
    if isinstance(binding, AdmissionProvider):
        binding = binding.for_connection(connection)
    if not isinstance(binding, AdmissionBindings):
        raise HTTPException(503, {"code": "model_admission_unavailable"})
    return binding

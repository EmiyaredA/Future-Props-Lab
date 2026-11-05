"""Explicit library input streams. Models never receive another service's storage paths."""

import asyncio
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from fastapi import HTTPException

from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.incoming import IncomingFile


class LocalInput:
    def __init__(self, path, filename, mime_type):
        self.filename, self.content_type = filename, mime_type
        self._source = Path(path).open("rb")

    async def read(self, size=-1):
        return await asyncio.to_thread(self._source.read, size)

    async def close(self):
        self._source.close()


class ExactInput:
    def __init__(self, incoming, byte_size):
        self.incoming, self.expected, self.received = incoming, byte_size, 0
        self.filename, self.content_type = incoming.filename, incoming.content_type

    async def read(self, size=-1):
        chunk = await self.incoming.read(size)
        if size == 0:
            return chunk
        self.received += len(chunk)
        if self.received > self.expected or (not chunk and self.received != self.expected):
            raise AssetError("来源文件传输不完整或大小已变化", code="source_changed", status=503)
        return chunk

    async def close(self):
        await self.incoming.close()


@dataclass(frozen=True)
class LibraryInput:
    asset_id: str
    media_kind: str
    byte_size: int
    incoming: IncomingFile


class LibraryInputs(Protocol):
    def open(self, asset_id: str) -> AbstractAsyncContextManager[LibraryInput]: ...


@dataclass(frozen=True)
class LibraryInputBindings:
    for_request: Callable[..., LibraryInputs]


def library_inputs(request, session, owner_user_id):
    if session.info.get("owner_user_id") != owner_user_id:
        raise HTTPException(403, {"code": "account_context_mismatch"})
    binding = getattr(request.app.state, "model_library_inputs", None)
    if not isinstance(binding, LibraryInputBindings):
        raise HTTPException(503, {"code": "model_library_inputs_unavailable"})
    return binding.for_request(request, session, owner_user_id)

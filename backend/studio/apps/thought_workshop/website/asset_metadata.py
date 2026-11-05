"""Validated library metadata supplied by the owning Assets service or recovery adapter."""

import asyncio
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from studio.apps.thought_workshop.errors import ThoughtError


@dataclass(frozen=True)
class LibraryAsset:
    id: str
    original_filename: str
    mime_type: str
    media_kind: str
    byte_size: int
    revision: int


@dataclass(frozen=True)
class AssetMetadataBindings:
    for_request: Callable


class AssetMetadata(Protocol):
    """An owner-authorized reader; download must stop writing before returning or cancelling."""

    async def describe(self, asset_ids: set[str]) -> dict[str, LibraryAsset]: ...
    async def download(self, asset: LibraryAsset, target): ...


def metadata(session, owner_user_id: str) -> AssetMetadata:
    bound = session.info.get("owner_user_id")
    if bound is not None and bound != owner_user_id:
        raise ThoughtError("素材账号上下文不匹配", 403, "asset_context_mismatch")
    factory = session.info.get("thought_asset_metadata_factory")
    if factory is None:
        raise ThoughtError("素材目录尚未连接", 503, "asset_metadata_unavailable")
    return factory(session, owner_user_id)


async def read_bytes(port: AssetMetadata, asset: LibraryAsset) -> bytes:
    """Read a verified version through the explicit port, using only local staging."""
    with tempfile.TemporaryDirectory(prefix="thought-asset-") as directory:
        target = Path(directory) / "content"
        await port.download(asset, target)
        return await asyncio.to_thread(target.read_bytes)

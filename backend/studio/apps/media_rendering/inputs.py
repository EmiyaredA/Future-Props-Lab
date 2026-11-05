"""Read exactly the authorized source over HTTP; temporary input is never a foreign mount."""

import contextlib
import tempfile
from contextlib import asynccontextmanager
from email.message import Message
from pathlib import Path

from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.media_content import MediaDescription
from studio.runtime.http.capability_client import CapabilityUnavailable


@asynccontextmanager
async def input_file(*, settings, capabilities, owner, assertion, method, path, asset_id):
    base = settings.account_path(owner) / ".tmp" / "inputs"
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not base.resolve().is_relative_to(settings.account_path(owner)):
        raise AssetError("处理暂存目录不可用", code="storage_unavailable", status=503)
    directory = Path(tempfile.mkdtemp(prefix="read-", dir=base))
    source = directory / "source.bin"
    try:
        async with capabilities.file_source(
            assertion=assertion,
            source_method=method,
            source_path=path,
            asset_id=asset_id,
        ) as response:
            try:
                revision = int(response.headers["X-Fpl-File-Revision"])
                size = int(response.headers["Content-Length"])
                kind = response.headers["X-Fpl-File-Kind"]
                mime = response.headers["Content-Type"].split(";", 1)[0]
                disposition = Message()
                disposition["Content-Disposition"] = response.headers["Content-Disposition"]
                filename = disposition.get_filename()
                if (
                    revision < 0
                    or size < 1
                    or kind not in {"image", "video", "audio", "font", "document"}
                    or not filename
                ):
                    raise ValueError()
            except (ValueError, KeyError, TypeError) as exc:
                raise CapabilityUnavailable("来源文件描述不完整") from exc
            if size > settings.max_input_bytes:
                raise AssetError("文件超过处理大小限制", code="file_too_large", status=413)
            received = 0
            with source.open("xb") as target:
                async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
                    received += len(chunk)
                    if received > settings.max_input_bytes or received > size:
                        raise AssetError("文件超过处理大小限制", code="file_too_large", status=413)
                    target.write(chunk)
            if received != size:
                raise CapabilityUnavailable("来源文件传输未完成")
        yield MediaDescription(asset_id, revision, owner, kind, mime, filename), source
    finally:
        source.unlink(missing_ok=True)
        with contextlib.suppress(OSError):
            directory.rmdir()

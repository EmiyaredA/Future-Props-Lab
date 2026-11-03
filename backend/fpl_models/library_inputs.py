"""Read a current account's library input through bounded, purpose-specific HTTP."""

from contextlib import asynccontextmanager

from app.capabilities.asset_store.errors import AssetError
from app.llm.library_inputs import LibraryInput
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.model_inputs import ModelInputDescription


class StreamInput:
    def __init__(self, response, description):
        self.filename, self.content_type = description.filename, description.mime_type
        self.iterator = response.aiter_bytes(chunk_size=64 * 1024).__aiter__()
        self.buffer, self.ended = bytearray(), False
        self.expected, self.received = description.byte_size, 0

    async def read(self, size=-1):
        if type(size) is not int or size < -1:
            raise ValueError("素材输入读取大小无效")
        if size == 0:
            return b""
        limit = self.expected + 1 if size == -1 else min(size, 1024 * 1024)
        while len(self.buffer) < limit and not self.ended:
            try:
                chunk = await anext(self.iterator)
                self.received += len(chunk)
                if self.received > self.expected:
                    raise AssetError("来源文件大小已变化", code="source_changed", status=503)
                self.buffer.extend(chunk)
            except StopAsyncIteration:
                self.ended = True
                if self.received != self.expected:
                    raise AssetError(
                        "来源文件传输不完整", code="source_changed", status=503
                    ) from None
        chunk = bytes(self.buffer[:limit])
        del self.buffer[:limit]
        return chunk

    async def close(self):
        await self.iterator.aclose()
        self.buffer.clear()
        self.ended = True


class HttpLibraryInputs:
    def __init__(self, capabilities, *, assertion, method, path, max_bytes):
        self.capabilities, self.assertion, self.method, self.path, self.max_bytes = (
            capabilities,
            assertion,
            method,
            path,
            max_bytes,
        )

    @asynccontextmanager
    async def open(self, asset_id):
        try:
            async with self.capabilities.model_library_source(
                assertion=self.assertion,
                source_method=self.method,
                source_path=self.path,
                asset_id=asset_id,
            ) as response:
                try:
                    description = ModelInputDescription.from_headers(response.headers)
                except (ValueError, KeyError, TypeError):
                    raise CapabilityUnavailable("文件库输入描述不完整") from None
                if description.byte_size > self.max_bytes:
                    raise AssetError("输入素材超过上传上限", code="file_too_large", status=413)
                incoming = StreamInput(response, description)
                try:
                    yield LibraryInput(
                        asset_id, description.media_kind, description.byte_size, incoming
                    )
                finally:
                    await incoming.close()
        except CapabilityDenied as exc:
            status = exc.status if exc.status in {401, 403, 404, 422} else 503
            raise AssetError("来源素材不可读", code="source_unavailable", status=status) from None
        except CapabilityUnavailable:
            raise AssetError("文件库输入暂不可用", code="source_unavailable", status=503) from None

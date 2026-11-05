"""Read a bounded sequence of size-prefixed media bodies from an HTTP stream."""

from struct import Struct

from anyio.to_thread import run_sync

from studio.runtime.http.capability_client import CapabilityUnavailable

SIZE = Struct(">Q")


class FramedInputs:
    def __init__(self, chunks):
        self.chunks = aiter(chunks)
        self.buffer = bytearray()
        self.received = 0

    async def read(self, size):
        while len(self.buffer) < size:
            chunk = await anext(self.chunks, b"")
            if not chunk:
                raise CapabilityUnavailable("渲染原件传输未完成")
            self.buffer.extend(chunk)
        data = bytes(self.buffer[:size])
        del self.buffer[:size]
        self.received += size
        return data

    async def transfer(self, target, size):
        remaining = size
        while remaining:
            chunk = await self.read(min(remaining, 1024 * 1024))
            await run_sync(target.write, chunk)
            remaining -= len(chunk)

    async def require_end(self, total):
        if self.received != total or self.buffer or await anext(self.chunks, b""):
            raise CapabilityUnavailable("媒体传输包含额外数据或长度不符")


def stream_files(sources):
    for path, size in sources:
        yield SIZE.pack(size)
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                yield chunk


def content_length(sources):
    return sum(SIZE.size + size for _, size in sources)

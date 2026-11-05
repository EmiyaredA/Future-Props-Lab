"""Bounded JSONL compaction of inline image strings, preserving native byte offsets."""

from __future__ import annotations

import re

IMAGE_PREFIX = re.compile(rb"data:image(?:/|\\/)[A-Za-z0-9.+-]+;base64,")


class ImageCompactor:
    def __init__(self, limit: int):
        self.limit = limit
        self.output = bytearray()
        self.inside = False
        self.probe: bytearray | None = None
        self.dropping = False
        self.slashes = 0

    def append(self, data: bytes):
        if len(self.output) + len(data) > self.limit:
            raise ValueError("来源单条记录去除内嵌图片后仍超过读取限制")
        self.output.extend(data)

    def content(self, data: bytes, *, closing=False):
        if not self.inside:
            self.append(data)
            return
        if self.probe is not None:
            take = min(128 - len(self.probe), len(data))
            self.probe.extend(data[:take])
            data = data[take:]
            if len(self.probe) < 128 and not closing:
                return
            self.dropping = bool(IMAGE_PREFIX.match(self.probe))
            self.append(b"data:image/png;base64," if self.dropping else self.probe)
            self.probe = None
        if not self.dropping:
            self.append(data)

    def feed(self, data: bytes):
        start = 0
        search = 0
        prior_slashes = self.slashes
        while (quote := data.find(b'"', search)) >= 0:
            slash = quote
            while slash > start and data[slash - 1] == 92:
                slash -= 1
            count = quote - slash + (prior_slashes if slash == 0 else 0)
            search = quote + 1
            if self.inside and count % 2:
                continue
            self.content(data[start:quote], closing=self.inside)
            self.append(b'"')
            self.inside = not self.inside
            self.probe = bytearray() if self.inside else None
            self.dropping = False
            start = search
            prior_slashes = 0
        self.content(data[start:])
        tail = len(data)
        while tail > start and data[tail - 1] == 92:
            tail -= 1
        self.slashes = len(data) - tail + (prior_slashes if tail == 0 else 0)


def compact_image_record(stream, initial: bytes, *, limit: int, wire_limit: int, chunk_size: int):
    """Return compact JSON bytes and original length, or None for a trailing half line.

    Only JSON strings beginning with an inline image data URL are discarded. All
    other JSON bytes remain intact and must still fit the ordinary record limit.
    The source is never rewritten, and checkpoints count original bytes.
    """
    compactor = ImageCompactor(limit)
    consumed = 0
    chunk = initial
    while chunk:
        consumed += len(chunk)
        if consumed > wire_limit:
            raise ValueError("来源单条记录原始体积超过读取限制")
        compactor.feed(chunk)
        if chunk.endswith(b"\n"):
            return bytes(compactor.output), consumed
        chunk = stream.readline(chunk_size)
    return None, consumed

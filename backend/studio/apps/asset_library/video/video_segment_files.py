"""Publish a sealed segment group in one short transaction after checking every byte."""

from app.capabilities.asset_store.errors import AssetError
from studio.apps.asset_library.library_outputs import VerifiedOutput
from studio.apps.asset_library.scoped_writes import VideoFileWrites
from studio.apps.asset_library.video.video_files import record as file_record
from studio.contracts.video_editor.video_segments import MAX_MANIFEST_BYTES, PublishedSegment


class SegmentBody:
    def __init__(self, stream):
        self.stream = stream
        self.buffer = bytearray()
        self.ended = False

    async def read(self, size):
        while len(self.buffer) < size and not self.ended:
            try:
                self.buffer.extend(await anext(self.stream))
            except StopAsyncIteration:
                self.ended = True
        result = bytes(self.buffer[:size])
        del self.buffer[:size]
        return result

    async def manifest_bytes(self, length):
        if not 1 <= length <= MAX_MANIFEST_BYTES:
            raise AssetError("分段清单长度无效", code="segment_manifest_invalid", status=422)
        return await self.read(length)

    async def finished(self):
        if await self.read(1):
            raise AssetError("分段归档有额外数据", code="segment_body_changed", status=422)

    async def close(self):
        await self.stream.aclose()
        self.buffer.clear()
        self.ended = True


class SegmentFile:
    def __init__(self, body, size):
        self.body, self.remaining = body, size

    async def read(self, size=-1):
        chunk = await self.body.read(min(self.remaining, size if size >= 0 else 1024 * 1024))
        self.remaining -= len(chunk)
        return chunk

    async def close(self):
        # The following segment still owns the shared request stream.
        pass


class SegmentFileWrites(VideoFileWrites):
    def record(self, project, row):
        return PublishedSegment(
            asset=file_record(project, row), sha256=self.digests[row.storage_key]
        ).model_dump(mode="json")

    async def publish(self, manifest, body, file_limit):
        self.digests = {}

        async def stage():
            for descriptor in manifest.files:
                row = await self.library.store_upload(
                    VerifiedOutput(SegmentFile(body, descriptor.byte_size), descriptor),
                    owner_user_id=self.owner,
                    video_editor_project_id=self.project,
                    allowed_extensions={".mp4"},
                    max_bytes=file_limit,
                    defer_persistence=True,
                )
                self.digests[row.storage_key] = descriptor.content_sha256
                yield row, self.storage.path_for(row)
            await body.finished()

        async def verify_previous():
            for descriptor in manifest.files:
                source = VerifiedOutput(SegmentFile(body, descriptor.byte_size), descriptor)
                while await source.read(1024 * 1024):
                    pass
            await body.finished()

        return await self.write(stage, verify_previous=verify_previous)

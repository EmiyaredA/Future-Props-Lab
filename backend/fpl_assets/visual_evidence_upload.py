"""Stage a complete batch of verified PNG evidence under one retention intent."""

from sqlalchemy import text

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.storage import AssetStorage
from fpl_runtime.framed_media import SIZE, FramedInputs
from fpl_runtime.visual_samples import VisualEvidenceUpload

from .library_outputs import VerifiedOutput
from .visual_upload_stages import VisualUploadFiles, _discard, conflict, staged_record


class FrameIncoming:
    def __init__(self, stream, frame):
        self.stream, self.remaining = stream, frame.byte_size
        self.filename, self.content_type = frame.filename, frame.mime_type

    async def read(self, size=-1):
        length = self.remaining if size < 0 else min(self.remaining, size)
        if length == 0:
            return b""
        data = await self.stream.read(length)
        self.remaining -= len(data)
        return data

    async def close(self):
        return


def invalid_frame():
    return AssetError("验收帧摘要或长度不符", code="visual_evidence_changed", status=422)


class EvidenceUploadFiles(VisualUploadFiles):
    async def _begin_evidence(self, length):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        stage = await self._stage()
        try:
            description = VisualEvidenceUpload.model_validate(stage.descriptor)
        except ValueError:
            raise AssetError("验收证据准备不存在", code="not_found", status=404) from None
        total = sum(SIZE.size + row.byte_size for row in description.frames)
        if length != total:
            raise invalid_frame()
        if stage.state != "reserved":
            return self._receipt(stage), None, (), None
        stage.state = "writing"
        keys, project = tuple(stage.storage_keys), stage.project_id
        await self.session.commit()
        return None, description, keys, project

    async def receive_frames(self, chunks, length, require_active):
        await require_active()
        prior, description, keys, project = await self._begin_evidence(length)
        if prior is not None:
            return prior
        stream = FramedInputs(chunks)
        storage = AssetStorage(self.settings)
        try:
            records = []
            for key, frame in zip(keys, description.frames, strict=True):
                if SIZE.unpack(await stream.read(SIZE.size))[0] != frame.byte_size:
                    raise invalid_frame()
                incoming = VerifiedOutput(
                    FrameIncoming(stream, frame), frame, changed=invalid_frame()
                )
                row = await AssetLibrary(self.session, self.settings).store_upload(
                    incoming,
                    owner_user_id=self.owner,
                    visual_project_id=project,
                    allowed_extensions={".png"},
                    max_bytes=frame.byte_size,
                    defer_persistence=True,
                    reserved_storage_key=key,
                )
                row.display_name = f"验收取样 {frame.position_ms} ms"
                records.append(staged_record(row))
            await stream.require_end(length)
            await require_active(sealed=True)
            await self.session.execute(text("BEGIN IMMEDIATE"))
            stage = await self._stage()
            if stage.state != "writing":
                raise conflict("visual_upload_aborted")
            stage.originals, stage.state = records, "sealed"
            result = self._receipt(stage)
            await self.session.commit()
            return result
        except BaseException:
            await self.session.rollback()
            await _discard(self.session, storage, self.intent_id)
            raise

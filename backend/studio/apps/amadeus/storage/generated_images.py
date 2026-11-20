"""Publish validated Codex originals and their durable, account-owned receipts."""

import hashlib
from io import BytesIO

from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from studio.contracts.amadeus.conversations import RunEventIn
from studio.contracts.amadeus.images import (
    MAX_GENERATED_IMAGE_BYTES,
    MAX_GENERATED_IMAGE_PIXELS,
    GeneratedImage,
    ImageGenerationEvent,
)
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.tasks.blocking_io import run_blocking_io

from .files import open_work_file, write_file
from .models import AmadeusRunEvent
from .runs import RunRecords


def image_metadata(data: bytes) -> dict:
    if not data or len(data) > MAX_GENERATED_IMAGE_BYTES:
        raise OperationError("生成图片为空或超过 50 MiB", "invalid_generated_image", 422)
    try:
        with Image.open(BytesIO(data), formats=("PNG", "JPEG", "WEBP")) as image:
            width, height = image.size
            if width * height > MAX_GENERATED_IMAGE_PIXELS:
                raise OperationError("生成图片超过解码尺寸限制", "invalid_generated_image", 422)
            mime = Image.MIME[image.format]
            image.verify()
        # verify() does not decode compressed pixel data for every format.
        with Image.open(BytesIO(data), formats=("PNG", "JPEG", "WEBP")) as image:
            image.load()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        raise OperationError("生成图片无法解码", "invalid_generated_image", 422) from None
    return {"mime_type": mime, "width": width, "height": height}


def save_original(owner, conversation, run, item_id, data, root):
    metadata = image_metadata(data)
    suffix = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[metadata["mime_type"]]
    identity = hashlib.sha256(item_id.encode()).hexdigest()[:20]
    name = f"codex-{run}-{identity}.{suffix}"
    try:
        file = write_file(
            owner, conversation, "outputs", name, data, "", files_root=root, generated_image=True
        )
    except OperationError as exc:
        if exc.code != "revision_conflict":
            raise
        prior, size = open_work_file(owner, conversation, "outputs", name, files_root=root)
        with prior:
            digest = hashlib.file_digest(prior, "sha256").hexdigest()
        if size != len(data) or digest != hashlib.sha256(data).hexdigest():
            raise OperationError(
                "生成图片回执与原件不一致", "image_receipt_conflict", 409
            ) from None
        file = {"kind": "outputs", "name": name, "bytes": size, "sha256": digest}
    return GeneratedImage(**file, **metadata)


def image_event_key(item_id: str) -> str:
    return "codex-image:" + hashlib.sha256(item_id.encode()).hexdigest()


class GeneratedImages:
    def __init__(self, sessions, principal, conversation, run, root):
        self.sessions, self.principal = sessions, principal
        self.conversation, self.run, self.root = conversation, run, root

    def session(self):
        return self.sessions(info={"owner_user_id": self.principal.user_id})

    async def receipt(self, item_id):
        async with self.session() as session:
            await RunRecords(session, self.principal).get(self.conversation, self.run)
            event = await session.scalar(
                select(AmadeusRunEvent).where(
                    AmadeusRunEvent.run_id == self.run,
                    AmadeusRunEvent.idempotency_key == image_event_key(item_id),
                )
            )
            return event.payload_json["image"] if event is not None else None

    async def save(self, item_id: str, data: bytes, *, authorize):
        ImageGenerationEvent(item_id=item_id, status="started")
        # Authentication is rechecked before I/O and again before publication.
        await authorize()
        async with self.session() as session:
            row = await RunRecords(session, self.principal).get(self.conversation, self.run)
            if (
                row.agent_id != "codex"
                or row.mode != "agent"
                or not row.execution_config.get("codex_image_generation", True)
                or not self.principal.allows("content.write")
                or row.status != "running"
            ):
                raise OperationError("当前运行未启用 Codex 生图", "image_generation_disabled", 403)
        image = await run_blocking_io(
            save_original,
            self.principal.user_id,
            self.conversation,
            self.run,
            item_id,
            data,
            self.root,
        )
        await authorize()
        event = ImageGenerationEvent(item_id=item_id, status="completed", image=image)
        try:
            async with self.session() as session:
                await RunRecords(session, self.principal).append_event(
                    self.conversation,
                    self.run,
                    RunEventIn(
                        kind="image_generation",
                        payload=event.model_dump(mode="json", exclude_none=True),
                        idempotency_key=image_event_key(item_id),
                    ),
                    saved_image=True,
                )
        except SQLAlchemyError:
            if receipt := await self.receipt(item_id):
                return receipt
            raise
        # If commit confirmation is lost the immutable original is deliberately retained.
        return image.model_dump(mode="json")

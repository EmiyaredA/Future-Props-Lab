"""Translate Codex image items, without trusting CLI-provided filesystem paths."""

import base64
import binascii
import os
import re
import stat
from pathlib import Path

from studio.contracts.amadeus.images import MAX_GENERATED_IMAGE_BYTES
from studio.runtime.tasks.blocking_io import run_blocking_io

from .transport import CliError

IMAGE_MESSAGE_BYTES = ((MAX_GENERATED_IMAGE_BYTES + 2) // 3) * 4 + 1024 * 1024


def safe_id(value):
    return re.sub(r"[^A-Za-z0-9_-]", "_", value) or "generated_image"


def generated_bytes(item, profile, root, thread_id):
    result = item.get("result")
    if isinstance(result, str) and result.strip():
        result = result.strip()
        if result.startswith("data:"):
            header, separator, result = result.partition(",")
            if not separator or header not in {
                "data:image/png;base64",
                "data:image/jpeg;base64",
                "data:image/webp;base64",
            }:
                raise CliError("Codex 返回的图片编码不受支持")
        if len(result) > IMAGE_MESSAGE_BYTES - 1024 * 1024:
            raise CliError("Codex 生成图片超过 50 MiB")
        try:
            data = base64.b64decode(result, validate=True)
        except (ValueError, binascii.Error):
            raise CliError("Codex 返回的图片编码无效") from None
        if not data or len(data) > MAX_GENERATED_IMAGE_BYTES:
            raise CliError("Codex 生成图片为空或超过 50 MiB")
        return data
    saved = item.get("savedPath")
    if not isinstance(saved, str):
        raise CliError("Codex 未交付可保存的图片原件")
    path = Path(saved)
    expected = profile / "generated_images" / safe_id(thread_id)
    local = root / "generated_images"
    # Both layouts are used by upstream Codex; never scan another thread or trust a basename.
    if not path.is_absolute() or path.parent not in {expected, local}:
        raise CliError("Codex 图片路径不属于当前运行")
    if path.name not in {safe_id(item["id"]) + suffix for suffix in (".png", ".jpg", ".webp")}:
        raise CliError("Codex 图片路径与生成记录不一致")
    directory_fd = os.open(
        profile if path.parent == expected else root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    )
    try:
        parts = (
            ("generated_images", safe_id(thread_id))
            if path.parent == expected
            else ("generated_images",)
        )
        for part in parts:
            next_fd = os.open(
                part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd
            )
            os.close(directory_fd)
            directory_fd = next_fd
        file_fd = os.open(
            path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd
        )
        with os.fdopen(file_fd, "rb") as file:
            metadata = os.fstat(file.fileno())
            if (
                not stat.S_ISREG(metadata.st_mode)
                or not 0 < metadata.st_size <= MAX_GENERATED_IMAGE_BYTES
            ):
                raise CliError("Codex 图片原件无效或超过 50 MiB")
            data = file.read(MAX_GENERATED_IMAGE_BYTES + 1)
            if len(data) > MAX_GENERATED_IMAGE_BYTES:
                raise CliError("Codex 图片原件超过 50 MiB")
            return data
    finally:
        os.close(directory_fd)


class ImageGeneration:
    def __init__(self, emit, save, profile, root):
        self.emit, self.save, self.profile, self.root = emit, save, profile, root
        self.started, self.finished = set(), set()
        self.failed = False

    async def accept(self, method, item, thread_id):
        identity = item.get("id")
        if not isinstance(identity, str) or not 0 < len(identity) <= 200:
            raise CliError("Codex 图片记录缺少有效标识")
        if identity in self.finished:
            return
        if identity not in self.started:
            await self.emit("image_generation", {"item_id": identity, "status": "started"})
            self.started.add(identity)
        if method != "item/completed":
            return
        try:
            if item.get("status") == "failed" or item.get("failure"):
                raise CliError("Codex 生图失败，请检查登录账号的图片额度和服务状态")
            data = await run_blocking_io(generated_bytes, item, self.profile, self.root, thread_id)
            await self.save(identity, data)
        except Exception:
            self.failed = True
            await self.emit(
                "image_generation",
                {
                    "item_id": identity,
                    "status": "failed",
                    "message": "图片生成或保存失败；请核对已有结果后手动继续。不会自动重新生图。",
                },
            )
        self.finished.add(identity)

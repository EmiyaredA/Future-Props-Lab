"""Private, immutable material files; never expose host paths over the API."""

import hashlib
import os
import re
from pathlib import Path

from studio.contracts.asset_library.incoming import IncomingFile
from studio.runtime.database.operation_receipts import OperationError

MAX_FILE_BYTES = 10 * 1024 * 1024
IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


def room_root(owner_user_id: str, room_id: str, *, state_root: Path) -> Path:
    if not all(IDENTIFIER.fullmatch(value) for value in (owner_user_id, room_id)):
        raise OperationError("文件标识无效")
    root = state_root / "accounts" / owner_user_id / "interview-assistant" / room_id
    cursor = root
    while cursor != cursor.parent:
        if cursor.is_symlink():
            raise OperationError("资料目录不能是符号链接")
        cursor = cursor.parent
    return root


def material_path(
    owner_user_id: str,
    room_id: str,
    material_id: str,
    filename: str,
    *,
    state_root: Path,
) -> Path:
    if not IDENTIFIER.fullmatch(material_id):
        raise OperationError("文件标识无效")
    suffix = Path(filename).suffix.lower()
    if suffix not in {".txt", ".md", ".pdf", ".docx"}:
        raise OperationError("支持 TXT、Markdown、PDF、DOCX 文件")
    path = (
        room_root(owner_user_id, room_id, state_root=state_root)
        / "materials"
        / f"{material_id}{suffix}"
    )
    if path.is_symlink() or path.parent.is_symlink():
        raise OperationError("资料文件不能是符号链接")
    return path


async def receive_material(incoming: IncomingFile) -> tuple[str, bytes, str]:
    try:
        filename = (incoming.filename or "").replace("\\", "/").split("/")[-1][:255]
        if Path(filename).suffix.lower() not in {".txt", ".md", ".pdf", ".docx"}:
            raise OperationError("支持 TXT、Markdown、PDF、DOCX 文件")
        data = await incoming.read(MAX_FILE_BYTES + 1)
        if not data or len(data) > MAX_FILE_BYTES:
            raise OperationError("简历必须非空且不超过 10 MB")
        return filename, data, hashlib.sha256(data).hexdigest()
    finally:
        await incoming.close()


def exclusive_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(data)

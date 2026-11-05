"""Package Thought-owned snapshots with version-bound Assets downloads."""

import json
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

from anyio.to_thread import run_sync
from sqlalchemy import text

from studio.apps.thought_workshop.backup_manifest import collect_backup
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.notes import Notes
from studio.apps.thought_workshop.website.asset_metadata import metadata


@dataclass(frozen=True)
class BackupLimits:
    maximum_files: int = 10_000
    maximum_bytes: int = 8 * 1024 * 1024 * 1024

    def __post_init__(self):
        if any(
            type(value) is not int or value < 1
            for value in (self.maximum_files, self.maximum_bytes)
        ):
            raise ValueError("Thought 备份限制无效")


async def export_backup(session, owner, knowledge_base_id, limits: BackupLimits):
    await session.rollback()
    await session.execute(text("BEGIN"))
    payload, asset_ids = await collect_backup(Notes(session, owner), knowledge_base_id)
    await session.rollback()
    if len(asset_ids) + 1 > limits.maximum_files:
        raise ThoughtError("笔记集合超过备份上限", 413)

    assets = metadata(session, owner)
    entries = await assets.describe(asset_ids)
    if set(entries) != asset_ids:
        raise ThoughtError("备份引用的文件不存在", 404)
    payload["assets"] = [
        {
            "id": id,
            "path": "assets/" + id,
            "filename": entries[id].original_filename,
            "content_type": entries[id].mime_type,
        }
        for id in sorted(entries)
    ]
    manifest = json.dumps(payload, ensure_ascii=False).encode()
    if (
        len(manifest) > 32 * 1024 * 1024
        or len(manifest) + sum(row.byte_size for row in entries.values()) > limits.maximum_bytes
    ):
        raise ThoughtError("备份超过大小限制", 413)

    root = Path(tempfile.mkdtemp(prefix="thought-backup-"))
    staged, target = root / "content", root / "thought-workshop.zip"
    try:
        with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED) as archive:
            await run_sync(archive.writestr, "manifest.json", manifest)
            for entry in payload["assets"]:
                asset = entries[entry["id"]]
                await assets.download(asset, staged)
                if staged.stat().st_size != asset.byte_size:
                    raise ThoughtError("备份素材内容与登记大小不一致", 409)
                await run_sync(archive.write, staged, entry["path"])
                staged.unlink()
        return target
    except BaseException:
        shutil.rmtree(root, ignore_errors=True)
        raise

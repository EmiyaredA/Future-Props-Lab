"""Credential-free task-local media MCP. No ORM, configuration or service credentials."""

import asyncio
import base64
import hashlib
import json
import os
import sys
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from mcp.server import MCPServer
from mcp.types import ImageContent, TextContent
from PIL import Image

from app.capabilities.media_rendering.inspection import inspect_media
from app.capabilities.media_rendering.video_frames import extract_frame
from app.capabilities.media_rendering.video_sampling import source_frame_time


def safe_file(root, name):
    if Path(name).name != name or name in {".", ".."}:
        raise ValueError("文件标识无效")
    path = root / name
    if path.is_symlink() or not path.is_file():
        raise ValueError("任务文件不存在")
    return path


def file_digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


class MediaTools:
    def __init__(self, root):
        self.root = root.resolve(strict=True)
        self.data = json.loads(safe_file(self.root, "manifest.json").read_text())
        self.lock = asyncio.Lock()
        self.extra = []
        self.read_ids = set()

    def persist(self):
        path = self.root / "receipts.json"
        temporary = self.root / "receipts.partial"
        temporary.write_text(json.dumps({"extra": self.extra, "read_ids": sorted(self.read_ids)}))
        os.replace(temporary, path)

    def checked(self, item):
        path = safe_file(self.root, item["file"])
        if file_digest(path) != item["sha256"]:
            raise ValueError("任务输入已变化")
        return path

    def picture(self, item):
        path = self.checked(item)
        with Image.open(path) as image:
            image.thumbnail((1024, 1024))
            image = image.convert("RGB")
            output = BytesIO()
            image.save(output, format="JPEG", quality=85)
        self.read_ids.add(item["id"])
        self.persist()
        return [
            TextContent(
                type="text",
                text=json.dumps(
                    {
                        "evidence_id": item["id"],
                        "source_asset_id": item["source_asset_id"],
                        "position_ms": item.get("position_ms"),
                    }
                ),
            ),
            ImageContent(
                type="image",
                mimeType="image/jpeg",
                data=base64.b64encode(output.getvalue()).decode(),
            ),
        ]

    async def manifest(self):
        return {
            "task": self.data["task"],
            "evidence": [
                {key: value for key, value in item.items() if key not in {"file", "sha256"}}
                for item in [*self.data["evidence"], *self.extra]
            ],
            "media": [
                {"id": item["id"], "kind": item["kind"], "label": item["label"]}
                for item in self.data["media"]
            ],
        }

    async def image(self, evidence_id: str):
        async with self.lock:
            item = next(
                (
                    item
                    for item in [*self.data["evidence"], *self.extra]
                    if item["id"] == evidence_id
                ),
                None,
            )
            if not item:
                raise ValueError("证据标识不存在")
            return await asyncio.to_thread(self.picture, item)

    async def sample(self, media_id: str, start_ms: int, end_ms: int, count: int = 6):
        async with self.lock:
            if not 1 <= count <= 12 or len(self.extra) + count > 24:
                raise ValueError("每次最多 12 帧，每个任务最多追加 24 帧")
            media = next((item for item in self.data["media"] if item["id"] == media_id), None)
            if not media or media["kind"] != "video":
                raise ValueError("视频标识不存在")
            source = self.checked(media)
            info = await inspect_media(source, "video")
            if not 0 <= start_ms < end_ms <= info["duration_ms"]:
                raise ValueError("取样区间超出时长")
            result = []
            for index in range(count):
                requested = round(start_ms + (end_ms - start_ms - 1) * index / max(1, count - 1))
                actual = await asyncio.to_thread(source_frame_time, source, requested * 1000)
                position = int(actual * 1000)
                identity = uuid4().hex
                path = self.root / f"sample-{identity}.png"
                await extract_frame(source, path, position, 1024)
                item = {
                    "id": identity,
                    "file": path.name,
                    "source_asset_id": media_id,
                    "position_ms": position,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
                self.extra.append(item)
                result.extend(await asyncio.to_thread(self.picture, item))
            return result


def main():
    tools = MediaTools(Path(sys.argv[1]))
    server = MCPServer("fpl-acceptance-task")
    server.tool()(tools.manifest)
    server.tool()(tools.image)
    server.tool()(tools.sample)
    server.run(transport="stdio")


if __name__ == "__main__":
    main()

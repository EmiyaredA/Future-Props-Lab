"""Validate the self-contained binary glTF format accepted by project uploads."""

import json
import struct
from pathlib import Path

MAX_GLB_BYTES = 50 * 1024 * 1024
MAX_GLB_JSON_BYTES = 4 * 1024 * 1024


def valid_glb(path: Path) -> bool:
    try:
        size = path.stat().st_size
        if not 20 <= size <= MAX_GLB_BYTES:
            return False
        with path.open("rb") as stream:
            magic, version, total, length, kind = struct.unpack("<4sIII4s", stream.read(20))
            if (
                magic != b"glTF"
                or version != 2
                or total != size
                or kind != b"JSON"
                or not 0 < length <= MAX_GLB_JSON_BYTES
                or length % 4
                or 20 + length > size
            ):
                return False
            value = json.loads(stream.read(length))
            if not isinstance(value, dict) or value.get("asset", {}).get("version") != "2.0":
                return False
            buffers = value.get("buffers", [])
            images = value.get("images", [])
            if not isinstance(buffers, list) or not isinstance(images, list) or len(buffers) > 1:
                return False
            if any(not isinstance(item, dict) or "uri" in item for item in [*buffers, *images]):
                return False
            if any(
                item.get("mimeType") not in {"image/jpeg", "image/png", "image/webp"}
                or not isinstance(item.get("bufferView"), int)
                for item in images
            ):
                return False
            if value.get("extensionsRequired"):
                return False
            if stream.tell() == size:
                return not buffers
            binary_length, binary_kind = struct.unpack("<I4s", stream.read(8))
            return (
                binary_kind == b"BIN\x00"
                and binary_length % 4 == 0
                and stream.tell() + binary_length == size
                and bool(buffers)
                and isinstance(buffers[0].get("byteLength"), int)
                and 0 < buffers[0]["byteLength"] <= binary_length
            )
    except (AttributeError, OSError, UnicodeError, ValueError, struct.error, RecursionError):
        return False

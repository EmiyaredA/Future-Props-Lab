"""Download and verify versioned original streams for deterministic rendering."""

import shutil

import httpx
from fastapi import HTTPException

from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.framed_media import SIZE, FramedInputs


async def original_files(state, scope, sizes, path, token, directory, *, operation="galgame_frame"):
    if not scope.files:
        return {}
    total = sum(SIZE.size + size for size in sizes.values())
    if any(size > state.settings.max_input_bytes for size in sizes.values()):
        raise HTTPException(413, f"{operation}_original_too_large")
    if total > shutil.disk_usage(directory).free:
        raise HTTPException(507, f"{operation}_staging_full")
    try:
        async with state.capabilities.client.stream(
            "POST",
            "http://assets:8080" + path,
            content=scope.model_dump_json().encode(),
            headers={
                HEADER: token,
                "Accept-Encoding": "identity",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(300, connect=5),
        ) as response:
            if response.status_code in {404, 409}:
                raise HTTPException(409, {"code": "source_changed", "message": "渲染原件已变化"})
            if response.status_code in {401, 403}:
                raise HTTPException(response.status_code, f"{operation}_original_denied")
            response.raise_for_status()
            if (
                response.headers.get("Content-Encoding", "identity") != "identity"
                or response.headers.get("Content-Type") != "application/octet-stream"
                or int(response.headers["Content-Length"]) != total
            ):
                raise ValueError("unexpected scoped original response")
            framed = FramedInputs(response.aiter_bytes(chunk_size=1024 * 1024))
            originals = {}
            for entry in scope.files:
                size = SIZE.unpack(await framed.read(SIZE.size))[0]
                if size != sizes[entry.id]:
                    raise ValueError("scoped original size changed")
                local = directory / entry.id
                with local.open("xb") as file:
                    await framed.transfer(file, size)
                originals[entry.id] = local
            await framed.require_end(total)
            return originals
    except (CapabilityUnavailable, httpx.HTTPError, KeyError, OSError, ValueError) as exc:
        raise HTTPException(503, f"{operation}_originals_unavailable") from exc

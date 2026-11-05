"""Read one authenticated Video project original over bounded streaming HTTP."""

import httpx
from anyio import open_file

from studio.contracts.video_editor.video_processing import ORIGINALS, MediaOriginal
from studio.runtime.http.capability_client import CapabilityUnavailable


async def download_original(client, peer, *, owner, project, asset, target, max_bytes):
    path = f"{ORIGINALS}/{project}/{asset}"
    headers = peer.headers("GET", path, owner)
    headers["Accept-Encoding"] = "identity"
    try:
        async with client.stream(
            "GET",
            "http://assets:8080" + path,
            headers=headers,
            timeout=httpx.Timeout(180, connect=5),
        ) as response:
            if response.status_code in {404, 409}:
                raise ValueError("剪辑素材原件不可用")
            response.raise_for_status()
            if response.headers.get("Content-Encoding", "identity") != "identity":
                raise ValueError("剪辑原件编码无效")
            original = MediaOriginal(
                kind=response.headers["X-Fpl-Media-Kind"],
                byte_size=int(response.headers["Content-Length"]),
            )
            if original.byte_size > max_bytes:
                raise ValueError("剪辑素材原件超过处理大小限制")
            received = 0
            async with await open_file(target, "xb") as file:
                async for chunk in response.aiter_raw():
                    received += len(chunk)
                    if received > original.byte_size:
                        raise ValueError("剪辑素材原件长度不符")
                    await file.write(chunk)
            if received != original.byte_size:
                raise CapabilityUnavailable("剪辑原件传输未完成")
            return original
    except (httpx.HTTPError, KeyError) as exc:
        raise CapabilityUnavailable("剪辑素材原件暂不可用") from exc

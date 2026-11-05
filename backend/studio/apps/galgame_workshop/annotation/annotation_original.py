"""Stream the exact verified Annotation audio into Galgame's private job staging."""

import hashlib

import httpx
from anyio import open_file

from studio.contracts.galgame_workshop.galgame_annotation_source import AUDIO_PATH, AUDIO_PURPOSE
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.project_errors import ProjectResourceError

MAX_ORIGINAL_BYTES = 8 * 1024**3


async def fetch_original(
    capabilities, assertion, source_path, project_id, annotation_id, asset_id, sha256, output
):
    path = f"{AUDIO_PATH}/{project_id}/{annotation_id}/{asset_id}/original/{sha256}"
    grant = RequestGrant("galgame", AUDIO_PURPOSE, "POST", source_path, "assets", "GET", path)
    try:
        token = await capabilities.authorize_request(assertion, grant)
        async with capabilities.client.stream(
            "GET",
            "http://assets:8080" + path,
            headers={HEADER: token, "Accept-Encoding": "identity"},
            timeout=httpx.Timeout(300, connect=5),
        ) as response:
            if response.status_code in {401, 403, 404}:
                raise CapabilityDenied(response.status_code)
            if response.status_code == 409:
                raise ProjectResourceError("广播剧源音频摘要已变化", "source_audio_changed", 409)
            response.raise_for_status()
            size = int(response.headers["Content-Length"])
            if (
                not 0 < size <= MAX_ORIGINAL_BYTES
                or response.headers.get("Content-Encoding", "identity") != "identity"
            ):
                raise ValueError("unexpected original response")
            await copy_verified(response, size, sha256, output)
    except CapabilityDenied as exc:
        raise ProjectResourceError(
            "广播剧源音频不可用", "annotation_source_denied", exc.status
        ) from exc
    except (CapabilityUnavailable, httpx.HTTPError, ValueError, KeyError, OSError) as exc:
        raise ProjectResourceError(
            "广播剧源音频暂不可读取", "annotation_source_unavailable", 503
        ) from exc


async def copy_verified(response, size, sha256, output):
    digest = hashlib.sha256()
    received = 0
    async with await open_file(output, "xb") as file:
        try:
            async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
                received += len(chunk)
                if received > size:
                    raise ValueError("original exceeds declared length")
                digest.update(chunk)
                await file.write(chunk)
            if received != size or digest.hexdigest() != sha256:
                raise ProjectResourceError("广播剧源音频摘要已变化", "source_audio_changed", 409)
        except BaseException:
            # Close the handle before unlinking on platforms that lock open files.
            await file.aclose()
            output.unlink(missing_ok=True)
            raise

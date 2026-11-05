"""Read scoped ASR inputs and exchange one exact dispatch with Models."""

import hashlib
import re

import httpx
from anyio.to_thread import run_sync

from studio.contracts.asset_library.descriptions import ID
from studio.contracts.galgame_workshop.galgame_asr_execution import (
    CATALOG,
    DESCRIPTION_HEADER,
    ORIGINAL,
    ORIGINAL_HEADER,
    PURPOSE_CATALOG,
    PURPOSE_EXECUTION,
    PURPOSE_ORIGINAL,
    AsrCatalogEntry,
    AsrOutcome,
    source_path,
)
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.runtime.files.signed_payloads import ModelOutputDescription
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.project_errors import ProjectResourceError


async def authorize(capabilities, assertion, project, service, purpose, method, target):
    grant = RequestGrant("galgame", purpose, "POST", source_path(project), service, method, target)
    try:
        return await capabilities.authorize_request(assertion, grant)
    except CapabilityDenied as exc:
        raise ProjectResourceError("语音识别授权已结束", "asr_access_denied", exc.status) from exc


def require_response(response, message):
    if response.status_code in {401, 403, 404, 409, 413, 415, 422}:
        try:
            result = response.json()
            detail = result.get("detail")
            details = detail if isinstance(detail, dict) else result
            if isinstance(details.get("message"), str):
                message = details["message"][:4000]
        except (AttributeError, ValueError):
            pass
        raise ProjectResourceError(message, "asr_peer_rejected", response.status_code)
    response.raise_for_status()


async def catalog_entry(capabilities, assertion, project, model):
    if not re.fullmatch(ID, model):
        return None
    path = f"{CATALOG}/{model}"
    try:
        token = await authorize(
            capabilities, assertion, project, "models", PURPOSE_CATALOG, "GET", path
        )
        response = await capabilities.client.get(
            "http://models:8080" + path, headers={HEADER: token}
        )
        require_response(response, "语音识别模型不可用")
        data = response.json()
        return AsrCatalogEntry.model_validate(data) if data is not None else None
    except (httpx.HTTPError, ValueError, CapabilityUnavailable) as exc:
        raise ProjectResourceError(
            "语音识别模型目录暂不可用", "asr_catalog_unavailable", 503
        ) from exc


async def fetch_audio(capabilities, assertion, project, asset, revision, byte_limit, audio):
    path = f"{ORIGINAL}/{project}/{asset}/{revision}"
    token = await authorize(
        capabilities, assertion, project, "assets", PURPOSE_ORIGINAL, "GET", path
    )
    async with capabilities.client.stream(
        "GET",
        "http://assets:8080" + path,
        headers={HEADER: token, "Accept-Encoding": "identity"},
        timeout=httpx.Timeout(300, connect=5),
    ) as response:
        require_response(response, "语音识别原件不可用")
        descriptor = ModelOutputDescription.from_header(response.headers.get(ORIGINAL_HEADER, ""))
        if descriptor.byte_size > byte_limit:
            raise ProjectResourceError("语音识别原件超过模型大小限制", "asr_input_too_large", 413)
        if (
            response.headers.get("Content-Encoding", "identity") != "identity"
            or int(response.headers.get("Content-Length", "-1")) != descriptor.byte_size
        ):
            raise ProjectResourceError("语音识别原件长度已变化", "asr_input_changed", 409)
        count, digest = 0, hashlib.sha256()
        async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
            count += len(chunk)
            if count > descriptor.byte_size:
                raise ProjectResourceError("语音识别原件长度已变化", "asr_input_changed", 409)
            digest.update(chunk)
            await run_sync(audio.write, chunk)
        if count != descriptor.byte_size or digest.hexdigest() != descriptor.content_sha256:
            raise ProjectResourceError("语音识别原件摘要已变化", "asr_input_changed", 409)
        await run_sync(audio.seek, 0)
        return descriptor


async def model_outcome(capabilities, assertion, description, *, audio=None):
    method = "GET" if audio is None else "POST"
    token = await authorize(
        capabilities,
        assertion,
        description.project_id,
        "models",
        PURPOSE_EXECUTION,
        method,
        description.path,
    )
    headers = {HEADER: token}
    content = None
    if audio is not None:
        headers.update(
            {
                DESCRIPTION_HEADER: description.header(),
                "Content-Length": str(description.byte_size),
                "Content-Type": "application/octet-stream",
            }
        )
        content = audio_chunks(audio)
    response = await capabilities.client.request(
        method,
        "http://models:8080" + description.path,
        headers=headers,
        content=content,
        timeout=httpx.Timeout(340, connect=5),
    )
    if method == "GET" and response.status_code == 404:
        return None
    require_response(response, "Models 未接受这次语音识别任务")
    return AsrOutcome.model_validate_json(response.content)


async def audio_chunks(audio):
    while chunk := await run_sync(audio.read, 1024 * 1024):
        yield chunk

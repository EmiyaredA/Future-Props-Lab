"""Per-request, account-bound transport for an already staged Thought upload."""

import asyncio
import os
import secrets
import stat

import httpx
from pydantic import ValidationError

from app.capabilities.asset_store.schemas.files import VisualAssetOut
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.thought_workshop.thought_uploads import (
    ThoughtUploadDescription,
    ThoughtUploadReceiptAuthenticator,
    upload_path,
)
from studio.runtime.http.capability_client import (
    CapabilityClient,
    CapabilityDenied,
    CapabilityUnavailable,
)


def authenticate_receipt(
    authenticator, signature, *, method, owner, request_id, description, nonce, data
):
    authenticator.verify(
        signature,
        method=method,
        owner=owner,
        request_id=request_id,
        fingerprint=description.fingerprint,
        nonce=nonce,
        body=bytes(data),
    )
    receipt = VisualAssetOut.model_validate_json(data)
    if (
        receipt.source != "library"
        or receipt.project_id is not None
        or receipt.original_filename != description.filename
        or receipt.byte_size != description.byte_size
    ):
        raise ValueError("上传回执与源文件不匹配")
    return receipt


async def send_staged_upload(
    *,
    path,
    description,
    request_id,
    owner,
    assertion,
    source_path,
    credential,
    receipt_credential,
    catalog,
    transport=None,
):
    """Send once; any uncertain response leaves the caller's intent and bytes intact."""
    if not isinstance(description, ThoughtUploadDescription):
        raise ValueError("上传描述无效")
    if (
        not isinstance(credential, str)
        or not isinstance(receipt_credential, str)
        or credential == receipt_credential
    ):
        raise ValueError("Thought upload credentials must be distinct")
    authenticator = ThoughtUploadReceiptAuthenticator(receipt_credential)
    nonce = secrets.token_hex(16)
    target = upload_path(description.kind, request_id, description.fingerprint)
    grant = RequestGrant(
        "thought", "thought.library.upload", "POST", source_path, "assets", "POST", target
    )
    client = CapabilityClient(
        service="thought", credential=credential, catalog=catalog, transport=transport
    )
    try:
        token = await client.authorize_request(assertion, grant)
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as source:
                info = os.fstat(source.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size != description.byte_size:
                    raise ValueError("上传暂存文件不匹配")

                async def chunks():
                    while data := await asyncio.to_thread(source.read, 1024 * 1024):
                        yield data

                async with client.client.stream(
                    "POST",
                    "http://assets:8080" + target,
                    headers={
                        "X-Fpl-Context": token,
                        "X-Fpl-Upload-Descriptor": description.header(),
                        "X-Fpl-Upload-Nonce": nonce,
                        "Content-Type": "application/octet-stream",
                        "Content-Length": str(description.byte_size),
                    },
                    content=chunks(),
                    timeout=httpx.Timeout(600, connect=5),
                ) as response:
                    if response.status_code in {401, 403, 404, 409, 413, 422}:
                        raise CapabilityDenied(response.status_code)
                    if response.status_code != 200:
                        raise CapabilityUnavailable("上传结果未确认")
                    signature = response.headers.get("x-fpl-upload-receipt", "")
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > 64 * 1024:
                            raise CapabilityUnavailable("上传回执过大")
            return authenticate_receipt(
                authenticator,
                signature,
                method="POST",
                owner=owner,
                request_id=request_id,
                description=description,
                nonce=nonce,
                data=data,
            )
        except (httpx.HTTPError, OSError, ValueError, ValidationError) as exc:
            raise CapabilityUnavailable("上传结果未确认") from exc
    finally:
        await client.close()


async def fetch_upload_receipt(
    *,
    description,
    request_id,
    owner,
    assertion,
    source_path,
    credential,
    receipt_credential,
    catalog,
    transport=None,
):
    """Read and authenticate a current target receipt without resending file bytes."""
    if not isinstance(description, ThoughtUploadDescription):
        raise ValueError("上传描述无效")
    if (
        not isinstance(credential, str)
        or not isinstance(receipt_credential, str)
        or credential == receipt_credential
    ):
        raise ValueError("Thought upload credentials must be distinct")
    authenticator = ThoughtUploadReceiptAuthenticator(receipt_credential)
    nonce = secrets.token_hex(16)
    target = upload_path(description.kind, request_id, description.fingerprint)
    grant = RequestGrant(
        "thought", "thought.library.upload", "POST", source_path, "assets", "GET", target
    )
    client = CapabilityClient(
        service="thought", credential=credential, catalog=catalog, transport=transport
    )
    try:
        token = await client.authorize_request(assertion, grant)
        try:
            async with client.client.stream(
                "GET",
                "http://assets:8080" + target,
                headers={
                    "X-Fpl-Context": token,
                    "X-Fpl-Upload-Descriptor": description.header(),
                    "X-Fpl-Upload-Nonce": nonce,
                },
                timeout=10,
            ) as response:
                if response.status_code in {401, 403, 404, 409, 422}:
                    raise CapabilityDenied(response.status_code)
                if response.status_code != 200:
                    raise CapabilityUnavailable("上传回执暂不可用")
                signature = response.headers.get("x-fpl-upload-receipt", "")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 64 * 1024:
                        raise ValueError("上传回执过大")
            return authenticate_receipt(
                authenticator,
                signature,
                method="GET",
                owner=owner,
                request_id=request_id,
                description=description,
                nonce=nonce,
                data=data,
            )
        except (httpx.HTTPError, OSError, ValueError, ValidationError) as exc:
            raise CapabilityUnavailable("上传回执未确认") from exc
    finally:
        await client.close()

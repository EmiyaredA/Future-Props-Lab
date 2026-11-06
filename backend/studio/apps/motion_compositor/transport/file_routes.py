"""Read only assets granted for the corresponding public Motion operation."""

import hashlib
import re
from pathlib import Path
from typing import Annotated
from uuid import uuid4

import httpx
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from studio.apps.motion_compositor.projects import (
    MotionInvalid,
    MotionNotFound,
    MotionUnavailable,
)
from studio.apps.motion_compositor.schemas import (
    AssetImportIn,
    AssetListOut,
    AssetOut,
    ImportSourceListOut,
)
from studio.apps.motion_compositor.transport.dependencies import MotionDep
from studio.apps.motion_compositor.transport.website.errors import _error
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.motion_compositor.motion_assets import (
    PREFIX,
    PURPOSE,
    WRITE_PURPOSE,
    MotionCopyQuery,
)
from studio.runtime.files.signed_payloads import ModelOutputDescription
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable

router = APIRouter()
ASSETS = "http://assets:8080"
FORWARDED_RESPONSE = (
    "accept-ranges",
    "content-disposition",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
)


async def authorization(request, path, method="GET"):
    capabilities = request.app.state.motion_capabilities
    purpose = PURPOSE if method == "GET" else WRITE_PURPOSE
    grant = RequestGrant(
        "motion", purpose, request.method, request.url.path, "assets", method, path
    )
    token = await capabilities.authorize_request(request.state.service_assertion, grant)
    return capabilities.client, {"X-Fpl-Context": token, "Accept-Encoding": "identity"}


async def read_json(request, path, model):
    try:
        client, headers = await authorization(request, path)
        response = await client.get(ASSETS + path, headers=headers)
        response.raise_for_status()
        return model.model_validate(response.json())
    except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError):
        raise _error(MotionUnavailable("素材描述暂不可用")) from None


@router.get("/import-sources", response_model=ImportSourceListOut)
async def import_sources(request: Request) -> ImportSourceListOut:
    return await read_json(request, PREFIX + "/sources", ImportSourceListOut)


@router.get("/projects/{project_id}/assets", response_model=AssetListOut)
async def list_assets(request: Request, projects: MotionDep, project_id: str) -> AssetListOut:
    try:
        await projects.row(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None
    await projects.session.rollback()
    return await read_json(request, f"{PREFIX}/{project_id}/files", AssetListOut)


@router.get("/projects/{project_id}/assets/{asset_id}/file")
async def asset_file(
    request: Request, projects: MotionDep, project_id: str, asset_id: str
) -> StreamingResponse:
    try:
        await projects.row(project_id)
        await projects.session.rollback()
        path = f"{PREFIX}/{project_id}/files/{asset_id}"
        client, headers = await authorization(request, path)
        for key in ("range", "if-range"):
            if key in request.headers:
                headers[key] = request.headers[key]
        response = await client.send(
            client.build_request("GET", ASSETS + path, headers=headers), stream=True
        )
    except MotionNotFound as exc:
        raise _error(exc) from None
    except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError):
        raise _error(MotionUnavailable("素材原件暂不可用")) from None
    if (
        response.status_code not in {200, 206, 400, 416}
        or response.headers.get("content-encoding", "identity") != "identity"
    ):
        await response.aclose()
        error = (
            MotionNotFound("素材不存在")
            if response.status_code == 404
            else MotionUnavailable("素材原件暂不可用")
        )
        raise _error(error)

    async def chunks():
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()

    return StreamingResponse(
        chunks(),
        status_code=response.status_code,
        headers={
            key: response.headers[key] for key in FORWARDED_RESPONSE if key in response.headers
        },
        background=BackgroundTask(response.aclose),
    )


async def write_json(request, path, model, *, headers=None, **body):
    try:
        client, signed = await authorization(request, path, "POST")
        response = await client.post(
            ASSETS + path,
            headers={**signed, **(headers or {})},
            timeout=httpx.Timeout(120, connect=5),
            **body,
        )
        if response.status_code in {401, 403, 404, 409, 413, 422}:
            error = response.json()
            raise HTTPException(
                response.status_code,
                {
                    "code": error.get("code", "invalid_motion"),
                    "message": error.get("detail", "素材写入被拒绝"),
                },
            )
        response.raise_for_status()
        return model.model_validate(response.json())
    except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError):
        raise _error(MotionUnavailable("素材写入结果暂不可用")) from None


@router.post("/projects/{project_id}/assets", response_model=AssetOut)
async def upload_asset(
    request: Request,
    projects: MotionDep,
    project_id: str,
    file: Annotated[UploadFile, File()],
) -> AssetOut:
    try:
        await projects.row(project_id)
        await projects.session.rollback()
        digest, size = hashlib.sha256(), 0
        while chunk := await file.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
        if not size:
            raise HTTPException(422, {"code": "invalid_file_content", "message": "文件内容为空"})
        mime = (file.content_type or "").split(";", 1)[0].strip().lower()
        if not re.fullmatch(r"[a-z0-9.+-]+/[a-z0-9.+-]+", mime):
            mime = "application/octet-stream"
        try:
            descriptor = ModelOutputDescription(
                Path(file.filename or "").name, mime, size, digest.hexdigest()
            )
        except ValueError:
            raise MotionInvalid("文件名无效") from None
        await file.seek(0)

        async def chunks():
            while chunk := await file.read(1024 * 1024):
                yield chunk

        return await write_json(
            request,
            f"{PREFIX}/{project_id}/writes/{uuid4().hex}/upload/{descriptor.fingerprint}",
            AssetOut,
            headers={"Content-Length": str(size), "X-Fpl-Motion-File": descriptor.header()},
            content=chunks(),
        )
    except (MotionInvalid, MotionNotFound) as exc:
        raise _error(exc) from None
    finally:
        await file.close()


@router.post("/projects/{project_id}/assets/import", response_model=AssetListOut)
async def import_assets(
    request: Request,
    projects: MotionDep,
    project_id: str,
    body: AssetImportIn,
) -> AssetListOut:
    try:
        await projects.row(project_id)
        await projects.session.rollback()
        try:
            query = MotionCopyQuery(asset_ids=body.asset_ids)
        except ValueError:
            raise MotionInvalid("有素材不存在或不属于当前账号") from None
        return await write_json(
            request,
            f"{PREFIX}/{project_id}/writes/{uuid4().hex}/copy/{query.digest}",
            AssetListOut,
            json=query.model_dump(),
        )
    except (MotionInvalid, MotionNotFound) as exc:
        raise _error(exc) from None

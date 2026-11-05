"""Stream the current Motion project into its portable, versioned archive format."""

import json
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Annotated

import httpx
from anyio.to_thread import run_sync
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from studio.apps.motion_compositor.projects import (
    MotionInvalid,
    MotionNotFound,
    MotionProjects,
    MotionUnavailable,
)
from studio.apps.motion_compositor.schemas import ProjectOut
from studio.apps.motion_compositor.snapshot_format import archive_asset, archive_manifest
from studio.apps.motion_compositor.transport.file_routes import ASSETS, read_json
from studio.apps.motion_compositor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.motion_compositor.motion_assets import PREFIX, MotionAsset
from studio.contracts.motion_compositor.motion_preview import FrameFile
from studio.contracts.motion_compositor.motion_snapshot import PURPOSE, SnapshotScope
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.http.framed_media import SIZE, FramedInputs

router = APIRouter()


class ArchiveMetadata(BaseModel):
    items: list[MotionAsset]


async def write_archive(request, project_id, scope, assets, title, document, target):
    entries = [archive_asset(asset) for asset in assets]
    manifest = archive_manifest(title, document, entries)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if scope.files:
            path = f"{PREFIX}/{project_id}/snapshot/{scope.digest}"
            capabilities = request.app.state.motion_capabilities
            grant = RequestGrant("motion", PURPOSE, "GET", request.url.path, "assets", "POST", path)
            token = await capabilities.authorize_request(request.state.service_assertion, grant)
            async with capabilities.client.stream(
                "POST",
                ASSETS + path,
                content=scope.model_dump_json().encode(),
                headers={HEADER: token, "Accept-Encoding": "identity"},
                timeout=httpx.Timeout(120, connect=5),
            ) as response:
                if response.status_code == 409:
                    raise HTTPException(409, "motion_snapshot_source_changed")
                response.raise_for_status()
                if (
                    response.headers.get("Content-Encoding", "identity") != "identity"
                    or response.headers.get("Content-Type") != "application/octet-stream"
                ):
                    raise ValueError("unexpected snapshot source response")
                total = int(response.headers["Content-Length"])
                framed = FramedInputs(response.aiter_bytes(chunk_size=1024 * 1024))
                for asset, entry in zip(assets, entries, strict=True):
                    size = SIZE.unpack(await framed.read(SIZE.size))[0]
                    if size != asset.byte_size:
                        raise ValueError("snapshot source length mismatch")
                    with archive.open(entry["name"], "w", force_zip64=True) as file:
                        await framed.transfer(file, size)
                await framed.require_end(total)
        await run_sync(archive.writestr, "manifest.json", json.dumps(manifest, ensure_ascii=False))


@router.get(
    "/projects/{project_id}/snapshot", responses={200: {"content": {"application/zip": {}}}}
)
async def export_snapshot(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> FileResponse:
    try:
        projects = MotionProjects(session, owner_user_id)
        project = await projects.get(project_id)
        document = (await projects.document(project_id)).document
    except MotionNotFound as exc:
        raise _error(exc) from None
    await session.rollback()

    slots = request.app.state.snapshot_slots
    if slots.locked():
        raise HTTPException(429, "motion_snapshot_busy")
    async with slots:
        metadata = await read_json(
            request, f"{PREFIX}/{project_id}/snapshot-metadata", ArchiveMetadata
        )
        target = None
        completed = False
        try:
            scope = SnapshotScope(
                files=tuple(
                    FrameFile(id=asset.id, revision=asset.revision) for asset in metadata.items
                )
            )
            fd, name = tempfile.mkstemp(
                prefix="motion-snapshot-", suffix=".zip", dir=request.app.state.snapshot_staging
            )
            os.close(fd)
            target = Path(name)
            await write_archive(
                request, project_id, scope, metadata.items, project.title, document, target
            )
            active = await request.app.state.motion_identity.status(
                assertion=request.state.service_assertion,
                method=request.method,
                path=request.url.path,
            )
            if active is None:
                raise HTTPException(503, "identity_unavailable")
            if not active:
                raise HTTPException(401, "motion_snapshot_revoked")
            completed = True
        except (
            CapabilityDenied,
            CapabilityUnavailable,
            httpx.HTTPError,
            KeyError,
            OSError,
            ValueError,
        ):
            raise _error(MotionUnavailable("工程包原件暂不可用")) from None
        finally:
            if target is not None and not completed:
                target.unlink(missing_ok=True)
    return FileResponse(
        target,
        media_type="application/zip",
        filename="motion-project.zip",
        background=BackgroundTask(target.unlink, missing_ok=True),
    )


@router.post("/projects/snapshot-imports", response_model=ProjectOut)
async def import_snapshot(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
) -> ProjectOut:
    try:
        imports = request.app.state.motion_imports
        if imports is None:
            raise MotionUnavailable("工程包服务暂不可用")
        return await imports.run(session, owner_user_id, file, request.state.service_assertion)
    except (MotionInvalid, MotionUnavailable) as exc:
        raise _error(exc) from None
    finally:
        await file.close()

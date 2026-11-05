"""Forward one owned, revision-pinned Motion document for deterministic rendering."""

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from studio.apps.motion_compositor.projects import (
    MotionInvalid,
    MotionNotFound,
    MotionProjects,
    MotionUnavailable,
)
from studio.apps.motion_compositor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.motion_compositor.motion_preview import (
    MAX_SCENE_BYTES,
    PREFIX,
    PURPOSE,
    FrameFile,
    FrameRequest,
    FrameScope,
    active_media,
    sha256,
)
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.revisions import RevisionConflictError

router = APIRouter()


async def render(request, project_id, frame):
    body = frame.model_dump_json().encode()
    if len(body) > MAX_SCENE_BYTES:
        raise HTTPException(413, "motion_scene_too_large")
    target = f"{PREFIX}/{project_id}/{sha256(body)}/{frame.scope.digest}"
    capabilities = request.app.state.motion_capabilities
    grant = RequestGrant("motion", PURPOSE, "GET", request.url.path, "rendering", "POST", target)
    try:
        token = await capabilities.authorize_request(request.state.service_assertion, grant)
        async with capabilities.client.stream(
            "POST",
            "http://rendering:8080" + target,
            content=body,
            headers={HEADER: token, "Accept-Encoding": "identity"},
            timeout=httpx.Timeout(300, connect=5),
        ) as response:
            if response.status_code in {401, 403, 409, 413, 422, 429}:
                raise HTTPException(response.status_code, "motion_preview_rejected")
            response.raise_for_status()
            if (
                response.headers.get("Content-Type") != "image/png"
                or response.headers.get("Content-Encoding", "identity") != "identity"
            ):
                raise ValueError("unexpected preview response")
            payload = bytearray()
            async for chunk in response.aiter_bytes():
                if len(payload) + len(chunk) > MAX_SCENE_BYTES:
                    raise ValueError("oversized preview response")
                payload.extend(chunk)
            if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("invalid preview response")
            return bytes(payload)
    except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError):
        raise MotionUnavailable("精确帧暂不可用") from None


@router.get("/projects/{project_id}/preview/frame", responses={200: {"content": {"image/png": {}}}})
async def exact_frame(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    frame: int = Query(ge=0),
    revision: int | None = Query(default=None, ge=0),
) -> Response:
    try:
        projects = MotionProjects(session, owner_user_id)
        snapshot = await projects.document(project_id)
        if revision is not None and revision != snapshot.revision:
            raise RevisionConflictError(
                revision, snapshot.revision, snapshot.model_dump(mode="json", by_alias=True)
            )
        document = snapshot.document
        if frame >= document.settings.duration_frames:
            raise MotionInvalid("帧超出项目时长")
        assets = await projects.resources.describe_assets(project_id, active_media(document, frame))
        frozen = FrameRequest(
            frame=frame,
            revision=snapshot.revision,
            document=document.model_dump(mode="json", by_alias=True),
            scope=FrameScope(
                files=tuple(
                    FrameFile(id=key, revision=assets[key].revision) for key in sorted(assets)
                )
            ),
        )
        payload = await render(request, project_id, frozen)
    except (MotionNotFound, MotionInvalid, MotionUnavailable) as exc:
        raise _error(exc) from None
    return Response(payload, media_type="image/png", headers={"Cache-Control": "no-store"})

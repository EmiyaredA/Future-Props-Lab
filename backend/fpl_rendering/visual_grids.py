"""Render the exact authenticated Visual grid plan from Assets originals."""

from pathlib import Path
from tempfile import TemporaryDirectory

import jwt
from anyio.to_thread import run_sync
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from PIL import Image

from app.capabilities.identity.permissions import effective_permissions
from app.capabilities.media_rendering.image_grid import render_image_grid
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.visual_composition import (
    ASSETS,
    INPUT_HEADER,
    RENDER,
    GridPlan,
    grid_render_target,
)

from .scoped_originals import original_files

router = APIRouter(include_in_schema=False)


async def active(request, token):
    status = await request.app.state.identity.status(
        assertion=token, method="POST", path=request.url.path
    )
    if status is not True:
        raise HTTPException(401 if status is False else 503, "visual_grid_authority_ended")


@router.post(RENDER + "/{project_id}/{batch_id}/{digest}/{source_digest}")
async def render_visual_grid(
    request: Request,
    project_id: str,
    batch_id: str,
    digest: str,
    source_digest: str,
    body: GridPlan,
):
    path = request.url.path
    if (
        "origin" in request.headers
        or "cookie" in request.headers
        or not grid_render_target("POST", path)
        or digest != body.digest
        or source_digest != body.scope.digest
    ):
        raise HTTPException(403, "visual_grid_plan_changed")
    state = request.app.state
    token = request.headers.get(HEADER, "")
    source_token = request.headers.get(INPUT_HEADER, "")
    source_path = f"{ASSETS}/{project_id}/{batch_id}/originals/{source_digest}"
    try:
        actor = verify_context(
            token,
            service="rendering",
            method="POST",
            path=path,
            public_key=state.identity_public_key,
        )
        input_actor = verify_context(
            source_token,
            service="assets",
            method="POST",
            path=source_path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(401, "visual_grid_grant_required") from None
    if (
        actor != input_actor
        or actor.purpose != "studio"
        or "content.write"
        not in effective_permissions(actor.platform_role, frozenset(actor.scopes))
    ):
        raise HTTPException(403, "visual_grid_render_forbidden")
    await active(request, token)
    if state.visual_grid_slots.locked():
        raise HTTPException(429, "visual_grid_busy")
    async with state.visual_grid_slots:
        account = state.settings.account_path(actor.user_id)
        staging = account / ".tmp" / "visual-grids"
        if staging.is_symlink() or not staging.resolve().is_relative_to(account):
            raise HTTPException(503, "visual_grid_staging_unavailable")
        staging.mkdir(parents=True, exist_ok=True, mode=0o700)
        with TemporaryDirectory(dir=staging, prefix="grid-") as directory:
            root = Path(directory)
            originals = await original_files(
                state,
                body.scope,
                {row.asset_id: row.byte_size for row in body.items},
                source_path,
                source_token,
                root,
                operation="visual_grid",
            )
            try:
                output = root / "grid.png"
                await run_sync(
                    render_image_grid,
                    [originals[row.asset_id] for row in body.items],
                    [row.caption for row in body.items],
                    output,
                    len(body.items),
                )
                png = await run_sync(output.read_bytes)
            except (OSError, RuntimeError, ValueError, Image.DecompressionBombError) as exc:
                raise HTTPException(422, "visual_grid_invalid_images") from exc
    await active(request, token)
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, no-store"})

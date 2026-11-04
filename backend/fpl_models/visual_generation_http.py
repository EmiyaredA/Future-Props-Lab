"""Publish only account-bound Visual model choices, with credentials staying in Models."""

from typing import Literal

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.llm.visual_generation_model import VisualGenerationValidationError, select_visual_model
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.visual_generation import (
    MODEL,
    ORIGINALS_HEADER,
    PLANS,
    ModelSelection,
    VisualModelChoice,
    plan_target,
    settlement_path,
)
from fpl_runtime.visual_generation_plan import GenerationPlan

from .catalog_reads import owned_catalog

router = APIRouter(include_in_schema=False)


@router.post(MODEL + "/{digest}", response_model=VisualModelChoice)
async def choose_visual_model(request: Request, digest: str, body: ModelSelection):
    if body.digest != digest:
        raise HTTPException(403, "visual_generation_model_query_changed")
    async with owned_catalog(
        request, purpose="visual_generation_model", permission="models.use"
    ) as (
        actor,
        session,
    ):
        try:
            model, provider = await select_visual_model(
                session, actor.user_id, body.model_id, body.kind, body.audio_mode
            )
        except VisualGenerationValidationError as exc:
            raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
        return VisualModelChoice(
            model_id=model.id,
            provider_id=provider.id,
            provider_kind=provider.kind,
            provider_name=provider.name,
            model_slug=model.slug,
            temporary_upload_configured=bool(request.app.state.settings.fpl_temp_media_upload_url),
        )


@router.post(PLANS + "/{project_id}/{plan_id}/{digest}")
async def prepare_visual_generation(request: Request, body: GenerationPlan):
    if request.app.state.visual_generation_peer is None:
        raise HTTPException(503, "visual_generation_peer_unavailable")
    if request.url.path != body.path:
        raise HTTPException(403, "visual_generation_plan_changed")
    async with owned_catalog(
        request, purpose="visual_generation_plan", permission="models.use"
    ) as (
        actor,
        _session,
    ):
        scope = body.scope
        originals = request.headers.get(ORIGINALS_HEADER, "")
        if scope is not None:
            try:
                original_actor = verify_context(
                    originals,
                    service="assets",
                    method="POST",
                    path=scope.path(body.project_id, str(body.plan_id)),
                    public_key=request.app.state.identity_public_key,
                )
            except (jwt.InvalidTokenError, ValueError, TypeError):
                raise HTTPException(401, "visual_generation_originals_grant_required") from None
            if original_actor != actor:
                raise HTTPException(403, "visual_generation_originals_actor_mismatch")
        elif originals:
            raise HTTPException(403, "visual_generation_originals_scope_unexpected")
        try:
            return await request.app.state.visual_generation_intake.prepare(
                body, actor, request.headers[HEADER], originals
            )
        except VisualGenerationValidationError as exc:
            raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post(PLANS + "/{project_id}/{plan_id}/{digest}/{decision}")
async def settle_visual_generation(
    request: Request,
    project_id: str,
    plan_id: str,
    digest: str,
    decision: Literal["activate", "abort"],
):
    path = request.url.path
    owner = peer_owner(request, path.rsplit("/", 1)[0])
    if path != settlement_path(project_id, plan_id, digest, decision):
        raise HTTPException(403, "visual_generation_decision_required")
    try:
        return await request.app.state.visual_generation_intake.settle(
            owner, project_id, plan_id, digest, decision
        )
    except VisualGenerationValidationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


def peer_owner(request, plan_path):
    peer = request.app.state.visual_generation_peer
    if peer is None:
        raise HTTPException(503, "visual_generation_peer_unavailable")
    if (
        "cookie" in request.headers
        or "origin" in request.headers
        or plan_target("POST", plan_path) is None
    ):
        raise HTTPException(403, "visual_generation_decision_required")
    try:
        return peer.owner(request.method, request.url.path, request.headers)
    except ValueError:
        raise HTTPException(401, "visual_generation_decision_required") from None


TASKS = PLANS + "/{project_id}/{plan_id}/{digest}/tasks/{task_id}"


@router.get(TASKS)
async def read_visual_provider_task(
    request: Request,
    project_id: str,
    plan_id: str,
    digest: str,
    task_id: str,
):
    owner = peer_owner(request, f"{PLANS}/{project_id}/{plan_id}/{digest}")
    try:
        return await request.app.state.visual_generation_results.status(
            owner, project_id, plan_id, digest, task_id
        )
    except VisualGenerationValidationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post(TASKS + "/{action}/{expected}")
async def change_visual_provider_task(
    request: Request,
    project_id: str,
    plan_id: str,
    digest: str,
    task_id: str,
    action: Literal["cancel", "retry"],
    expected: int,
):
    owner = peer_owner(request, f"{PLANS}/{project_id}/{plan_id}/{digest}")
    try:
        return await request.app.state.visual_generation_results.change(
            owner, project_id, plan_id, digest, task_id, action, expected
        )
    except VisualGenerationValidationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get(TASKS + "/result/{sha256}")
async def download_visual_provider_result(
    request: Request,
    project_id: str,
    plan_id: str,
    digest: str,
    task_id: str,
    sha256: str,
):
    owner = peer_owner(request, f"{PLANS}/{project_id}/{plan_id}/{digest}")
    try:
        path, metadata = await request.app.state.visual_generation_results.file(
            owner, project_id, plan_id, digest, task_id, sha256
        )
    except VisualGenerationValidationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    return FileResponse(
        path,
        media_type=metadata["mime_type"],
        filename=metadata["filename"],
        headers={"Cache-Control": "private, no-store", "X-Fpl-Content-Sha256": metadata["sha256"]},
    )

"""Published Galgame transcription settings and history."""

import re

import httpx
from fastapi import APIRouter, HTTPException, Request

from app.apps.galgame_workshop.assets.asr_records import AsrRecords
from app.apps.galgame_workshop.schemas import (
    GalgameAsrSettingsOut,
    GalgameAsrSettingsPatchIn,
    GalgameTranscriptionTaskListOut,
)
from app.capabilities.asset_store.errors import AssetError
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.galgame_asr import PREFIX, PURPOSE, AsrModelStatus
from fpl_runtime.galgame_assets import SOURCE
from fpl_runtime.http_dependencies import OwnerDep, SessionDep
from fpl_runtime.library_assets import ID

router = APIRouter(prefix=SOURCE, tags=["galgame-workshop"])


def _asset_error(exc):
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc), **exc.detail})


def asr_records(request, session):
    async def model_ready(model_id):
        if not re.fullmatch(ID, model_id):
            return False
        capabilities = request.app.state.capabilities
        path = f"{PREFIX}/{model_id}"
        grant = RequestGrant(
            "galgame", PURPOSE, request.method, request.url.path, "models", "GET", path
        )
        try:
            token = await capabilities.authorize_request(request.state.service_assertion, grant)
            reply = await capabilities.client.get(
                "http://models:8080" + path, headers={HEADER: token}
            )
            if reply.status_code in {401, 403}:
                raise CapabilityDenied(reply.status_code)
            reply.raise_for_status()
            return AsrModelStatus.model_validate_json(reply.content).ready
        except CapabilityDenied as exc:
            raise AssetError(
                "语音识别模型目录授权已结束", code="asr_catalog_access_denied", status=exc.status
            ) from exc
        except (httpx.HTTPError, CapabilityUnavailable, ValueError) as exc:
            raise AssetError(
                "语音识别模型目录暂不可用", code="asr_catalog_unavailable", status=503
            ) from exc

    return AsrRecords(session, model_ready)


@router.get("/{project_id}/assets/asr/settings", response_model=GalgameAsrSettingsOut)
async def get_asr_settings(
    request: Request,
    session: SessionDep,
    project_id: str,
    _owner: OwnerDep,
) -> GalgameAsrSettingsOut:
    try:
        return await asr_records(request, session).get_settings(project_id)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.patch("/{project_id}/assets/asr/settings", response_model=GalgameAsrSettingsOut)
async def patch_asr_settings(
    request: Request,
    session: SessionDep,
    project_id: str,
    body: GalgameAsrSettingsPatchIn,
    _owner: OwnerDep,
) -> GalgameAsrSettingsOut:
    try:
        return await asr_records(request, session).patch_settings(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.get(
    "/{project_id}/assets/asr/transcriptions", response_model=GalgameTranscriptionTaskListOut
)
async def list_transcriptions(
    request: Request,
    session: SessionDep,
    project_id: str,
    _owner: OwnerDep,
) -> GalgameTranscriptionTaskListOut:
    try:
        return await asr_records(request, session).list_tasks(project_id)
    except AssetError as exc:
        raise _asset_error(exc) from None

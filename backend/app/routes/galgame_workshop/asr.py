from __future__ import annotations

# ruff: noqa: F405
from fastapi import APIRouter

from app.routes.galgame_workshop._shared import *  # noqa: F403
from app.routes.galgame_workshop._shared import _asset_error

router = APIRouter()


@router.get("/{project_id}/assets/asr/settings", response_model=GalgameAsrSettingsOut)
async def get_asr_settings(session: SessionDep, project_id: str) -> GalgameAsrSettingsOut:
    try:
        return await GalgameAsrService(session).get_settings(project_id)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.patch("/{project_id}/assets/asr/settings", response_model=GalgameAsrSettingsOut)
async def patch_asr_settings(
    session: SessionDep, project_id: str, body: GalgameAsrSettingsPatchIn
) -> GalgameAsrSettingsOut:
    try:
        return await GalgameAsrService(session).patch_settings(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post(
    "/{project_id}/assets/asr/transcriptions",
    response_model=GalgameTranscriptionTaskListOut,
)
async def create_transcriptions(
    session: SessionDep, project_id: str, body: GalgameTranscriptionCreateIn
) -> GalgameTranscriptionTaskListOut:
    try:
        return await GalgameAsrService(session).create_tasks(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.get(
    "/{project_id}/assets/asr/transcriptions",
    response_model=GalgameTranscriptionTaskListOut,
)
async def list_transcriptions(
    session: SessionDep, project_id: str
) -> GalgameTranscriptionTaskListOut:
    try:
        return await GalgameAsrService(session).list_tasks(project_id)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.patch("/{project_id}/assets/{asset_id}/transcript")
async def patch_asset_transcript(
    session: SessionDep,
    project_id: str,
    asset_id: str,
    body: GalgameTranscriptPatchIn,
) -> object:
    try:
        return await GalgameAsrService(session).patch_transcript(project_id, asset_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post("/{project_id}/assets/asr/match-dialogue", response_model=GalgameVoiceMatchOut)
async def match_voice_to_dialogue(
    session: SessionDep, project_id: str, body: GalgameVoiceMatchIn
) -> GalgameVoiceMatchOut:
    try:
        return await GalgameAsrService(session).match_dialogue(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None

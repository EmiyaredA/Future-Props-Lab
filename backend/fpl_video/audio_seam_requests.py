"""Check the owned edit revision and audio facts before requesting seam analysis."""

import httpx
from fastapi import HTTPException

from app.apps.video_editor.audio_seam_edit import audio_seam_pair, seam_window
from app.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from app.apps.video_editor.schemas.audio_seam import AudioSeamCandidatesOut
from app.apps.video_editor.timeline_read import VideoTimelineRead
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.motion_preview import sha256
from fpl_runtime.video_audio import AUDIO_SEAMS, PURPOSE, AudioSeamRequest

from .timeline_media import TimelineMedia


async def candidates(request, session, owner, project, body):
    timelines = VideoTimelineRead(session, owner)
    timeline = await timelines.row(project)
    if timeline.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision,
            timeline.revision,
            timelines.out(timeline).model_dump(mode="json", by_alias=True),
        )
    _, source, target = audio_seam_pair(timeline.document, body.from_clip_id, body.to_clip_id)
    capabilities = request.app.state.capabilities
    asset_id = source["assetId"]
    records = await TimelineMedia(request, session, owner, capabilities).describe(
        project, {asset_id}
    )
    asset = records.get(asset_id)
    if asset is None:
        raise VideoEditorNotFoundError("素材不存在")
    if asset.kind != "audio" or asset.processing_status != "ready":
        raise VideoEditorValidationError("音频素材尚未准备好", code="audio_not_ready")
    reference_end, search_end, rate = seam_window(source, target, asset.duration_us)
    try:
        plan = AudioSeamRequest(
            duration_us=asset.duration_us,
            reference_end_us=reference_end,
            search_end_us=search_end,
            rate=rate,
            fingerprint=asset.fingerprint,
        )
    except ValueError:
        raise VideoEditorValidationError("音频素材尚未准备好", code="audio_not_ready") from None
    await session.rollback()
    raw = plan.model_dump_json().encode()
    path = f"{AUDIO_SEAMS}/{project}/{asset_id}/{sha256(raw)}"
    grant = RequestGrant("video", PURPOSE, "POST", request.url.path, "rendering", "POST", path)
    try:
        token = await capabilities.authorize_request(request.state.service_assertion, grant)
        reply = await capabilities.client.post(
            "http://rendering:8080" + path,
            content=raw,
            headers={HEADER: token},
            timeout=httpx.Timeout(150, connect=5),
        )
        if reply.status_code == 422:
            error = reply.json()
            raise VideoEditorValidationError(
                str(error.get("detail", "音频分析解码失败")),
                code=str(error.get("code", "audio_decode_failed")),
            )
        if reply.status_code in {401, 403, 409, 429}:
            raise HTTPException(reply.status_code, "video_audio_analysis_rejected")
        reply.raise_for_status()
        result = AudioSeamCandidatesOut.model_validate(reply.json())
        if result.asset_id != asset_id:
            raise ValueError("unexpected audio receipt")
        return result
    except (httpx.HTTPError, CapabilityDenied, CapabilityUnavailable, ValueError):
        raise VideoEditorUnavailableError("音频候选分析暂不可用") from None

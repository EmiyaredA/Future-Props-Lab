"""Authenticate, execute and settle one provider attempt for Annotation."""

import hashlib
import io

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import text

from app.llm.annotation_transcription import AnnotationTranscription, AnnotationTranscriptionError
from studio.apps.model_service.storage.service_models import AnnotationTranscriptionAttempt
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.model_service.annotation import HEADER as INPUT_HEADER
from studio.contracts.model_service.annotation import MAX_BYTES, PREFIX, SegmentInput, SegmentResult
from studio.contracts.model_service.credential_snapshot import snapshot_from_actor

router = APIRouter(include_in_schema=False)


class SegmentAudio:
    content_type = "audio/wav"
    filename = "segment.wav"

    def __init__(self, body):
        self.stream = io.BytesIO(body)

    async def read(self, size=-1):
        return self.stream.read(size)

    async def close(self):
        self.stream.close()


async def actor(request):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_annotation_transcription_required")
    assertion = request.headers.get(HEADER, "")
    try:
        principal = verify_context(
            assertion,
            service="models",
            method=request.method,
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "annotation_transcription_authorization_required") from None
    if principal.purpose != "studio" or "models.use" not in effective_permissions(
        principal.platform_role, frozenset(principal.scopes)
    ):
        raise HTTPException(403, "annotation_transcription_authorization_forbidden")
    await require_active(request, assertion)
    return principal


async def require_active(request, assertion):
    active = await request.app.state.identity.status(
        assertion=assertion, method=request.method, path=request.url.path
    )
    if active is not True:
        raise HTTPException(
            401 if active is False else 503, "annotation_transcription_authority_ended"
        )


async def checked_audio(request, segment):
    try:
        size = int(request.headers.get("Content-Length", "0"))
    except ValueError:
        size = 0
    if size > MAX_BYTES:
        raise HTTPException(413, "annotation_audio_too_large")
    if (
        request.headers.get("Content-Type") != "audio/wav"
        or request.headers.get("Content-Encoding", "identity") != "identity"
        or size != segment.byte_size
    ):
        raise HTTPException(422, "annotation_audio_metadata_changed")
    result = bytearray()
    digest = hashlib.sha256()
    async for chunk in request.stream():
        if len(result) + len(chunk) > size:
            raise HTTPException(422, "annotation_audio_metadata_changed")
        digest.update(chunk)
        result.extend(chunk)
    if len(result) != size or digest.hexdigest() != segment.sha256:
        raise HTTPException(422, "annotation_audio_digest_mismatch")
    return SegmentAudio(result)


def as_error(failure):
    return {"status": failure.status, "code": failure.code, "message": str(failure)}


def raise_error(value):
    raise HTTPException(value["status"], {"code": value["code"], "message": value["message"]})


@router.post(PREFIX + "/{project_id}/{segment_id}/{fingerprint}", response_model=SegmentResult)
async def execute(request: Request, project_id: str, segment_id: str, fingerprint: str):
    principal = await actor(request)
    try:
        segment = SegmentInput.from_header(request.headers.get(INPUT_HEADER, ""))
    except (ValueError, ValidationError):
        raise HTTPException(422, "annotation_audio_metadata_invalid") from None
    if request.url.path != segment.path or (segment.project_id, segment.segment_id) != (
        project_id,
        segment_id,
    ):
        raise HTTPException(403, "annotation_audio_metadata_changed")
    upload = await checked_audio(request, segment)
    owner = principal.user_id
    key = owner, str(segment.attempt_id)
    try:
        await require_active(request, request.headers[HEADER])
        async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            previous = await session.get(AnnotationTranscriptionAttempt, key)
            if previous is not None:
                if previous.fingerprint != fingerprint:
                    raise HTTPException(409, "annotation_attempt_conflict")
                if previous.result is not None:
                    return SegmentResult.model_validate(previous.result)
                if previous.error is not None:
                    raise_error(previous.error)
                raise HTTPException(409, "annotation_attempt_outcome_unknown")
            session.add(
                AnnotationTranscriptionAttempt(
                    owner_user_id=owner, attempt_id=key[1], fingerprint=fingerprint
                )
            )
            await session.commit()

            async def settle(*, result=None, error=None):
                row = await session.get(AnnotationTranscriptionAttempt, key)
                if result is not None:
                    row.result = result.model_dump(mode="json")
                else:
                    row.error = as_error(error)

            try:
                return await AnnotationTranscription(session).transcribe(
                    project_id,
                    owner_user_id=owner,
                    upload=upload,
                    model_id=segment.model_id,
                    segment_id=segment_id,
                    start_ms=segment.start_ms,
                    end_ms=segment.end_ms,
                    language_tag=segment.language_tag,
                    target_language_tag=segment.target_language_tag,
                    credential=snapshot_from_actor(principal),
                    settle=settle,
                )
            except AnnotationTranscriptionError as failure:
                row = await session.get(AnnotationTranscriptionAttempt, key)
                if row.error is None:
                    await settle(error=failure)
                    await session.commit()
                raise_error(as_error(failure))
    finally:
        await upload.close()

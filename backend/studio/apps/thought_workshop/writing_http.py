"""Shared Thought writing HTTP operations using an application-bound model port."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.deps import OwnerDep
from app.llm.http_credentials import CallCredentialDep
from studio.apps.thought_workshop.assistant import models, prepare, writing_events
from studio.apps.thought_workshop.http_bindings import SessionDep
from studio.apps.thought_workshop.notes import Notes, ThoughtError
from studio.apps.thought_workshop.schemas.workshop import (
    ThoughtAssistantEvent,
    ThoughtAssistantIn,
    ThoughtModelOut,
)
from studio.apps.thought_workshop.writing import writing_models as get_writing_models


async def call(operation):
    try:
        return await operation
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


router = APIRouter()


@router.get("/models", response_model=list[ThoughtModelOut])
async def writing_models(request: Request, owner_user_id: OwnerDep):
    return await call(models(get_writing_models(request, owner_user_id)))


@router.post(
    "/notes/{note_id}/assistant",
    responses={
        200: {
            "content": {"text/event-stream": {"schema": ThoughtAssistantEvent.model_json_schema()}}
        }
    },
)
async def assistant(
    note_id: str,
    body: ThoughtAssistantIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
    credential: CallCredentialDep,
    request: Request,
):
    writing = get_writing_models(request, owner_user_id)
    prepared = await call(
        prepare(
            Notes(session, owner_user_id), note_id, body, writing=writing, credential=credential
        )
    )
    return StreamingResponse(
        writing_events(prepared, writing),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from studio.apps.model_service.call_logs.credentials import snapshot_from_principal
from studio.apps.model_service.transport.website.model_capacity import spawned_task_admission
from studio.apps.visual_workshop.assistant.attachments import AssistantAssetError
from studio.apps.visual_workshop.assistant.conversations import (
    AssistantBusyError,
    AssistantModelUnavailableError,
    AssistantNotFoundError,
    VisualAssistantConversations,
)
from studio.apps.visual_workshop.assistant.stream import assistant_events
from studio.apps.visual_workshop.schemas.workshop import (
    VisualAssistantApprovalIn,
    VisualAssistantApprovalOut,
    VisualAssistantConversationListOut,
    VisualAssistantConversationOut,
    VisualAssistantConversationPatchIn,
    VisualAssistantModelOptionListOut,
    VisualAssistantSendIn,
)
from studio.assembly.http_dependencies import SessionDep, StudioAuth
from studio.runtime.tasks.reactive_tools.approval import (
    ApprovalConflictError,
    ApprovalNotFoundError,
)

router = APIRouter(
    prefix="/visual-workshop/projects/{project_id}/conversations",
    tags=["visual-workshop-assistant"],
)


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, AssistantNotFoundError):
        return HTTPException(404, {"code": "not_found", "message": str(exc)})
    if isinstance(exc, AssistantAssetError):
        return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
    if isinstance(exc, AssistantModelUnavailableError):
        return HTTPException(409, {"code": "model_unavailable", "message": str(exc)})
    return HTTPException(409, {"code": "conversation_busy", "message": str(exc)})


@router.get("", response_model=VisualAssistantConversationListOut)
async def list_conversations(
    request: Request, session: SessionDep, project_id: str
) -> VisualAssistantConversationListOut:
    try:
        return await VisualAssistantConversations(session, request.app.state.settings).list(
            project_id
        )
    except AssistantNotFoundError as exc:
        raise _translate(exc) from None


@router.post("", response_model=VisualAssistantConversationOut)
async def create_conversation(
    request: Request, session: SessionDep, project_id: str
) -> VisualAssistantConversationOut:
    try:
        return await VisualAssistantConversations(session, request.app.state.settings).create(
            project_id
        )
    except (AssistantNotFoundError, AssistantModelUnavailableError) as exc:
        raise _translate(exc) from None


@router.get("/models", response_model=VisualAssistantModelOptionListOut)
async def list_models(
    request: Request, session: SessionDep, project_id: str
) -> VisualAssistantModelOptionListOut:
    try:
        return await VisualAssistantConversations(
            session, request.app.state.settings
        ).model_options(project_id)
    except AssistantNotFoundError as exc:
        raise _translate(exc) from None


@router.get("/{conversation_id}", response_model=VisualAssistantConversationOut)
async def get_conversation(
    request: Request, session: SessionDep, project_id: str, conversation_id: str
) -> VisualAssistantConversationOut:
    try:
        return await VisualAssistantConversations(session, request.app.state.settings).get(
            project_id, conversation_id
        )
    except AssistantNotFoundError as exc:
        raise _translate(exc) from None


@router.patch("/{conversation_id}", response_model=VisualAssistantConversationOut)
async def patch_conversation(
    request: Request,
    session: SessionDep,
    project_id: str,
    conversation_id: str,
    body: VisualAssistantConversationPatchIn,
) -> VisualAssistantConversationOut:
    try:
        return await VisualAssistantConversations(session, request.app.state.settings).patch(
            project_id, conversation_id, body
        )
    except (
        AssistantNotFoundError,
        AssistantBusyError,
        AssistantModelUnavailableError,
    ) as exc:
        raise _translate(exc) from None


@router.delete("/{conversation_id}")
async def delete_conversation(
    request: Request,
    session: SessionDep,
    project_id: str,
    conversation_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await VisualAssistantConversations(session, request.app.state.settings).delete(
            project_id, conversation_id, expected_revision
        )
    except (AssistantNotFoundError, AssistantBusyError) as exc:
        raise _translate(exc) from None
    return {"deleted": True}


@router.post("/{conversation_id}/messages/stream")
async def stream_message(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    project_id: str,
    conversation_id: str,
    body: VisualAssistantSendIn,
) -> StreamingResponse:
    settings = request.app.state.settings
    admission = spawned_task_admission(request, principal, "visual")
    try:
        credential = await snapshot_from_principal(session, principal)
        prepared = await VisualAssistantConversations(session, settings).prepare_send(
            project_id,
            conversation_id,
            body.expected_revision,
            body.canvas_revision,
            body.content,
            body.asset_ids,
            body.content_parts,
            credential=credential,
        )
    except (
        AssistantNotFoundError,
        AssistantBusyError,
        AssistantModelUnavailableError,
        AssistantAssetError,
    ) as exc:
        raise _translate(exc) from None
    return StreamingResponse(
        assistant_events(
            prepared,
            settings=settings,
            admission=admission,
            sessions=request.app.state.database.sessions,
            transport_resolver=request.app.state.model_provider_transports.resolve,
            approvals=request.app.state.assistant_approvals,
            decrypt=request.app.state.model_decrypt,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/{conversation_id}/runs/{run_id}/approvals/{approval_id}",
    response_model=VisualAssistantApprovalOut,
)
async def resolve_approval(
    request: Request,
    session: SessionDep,
    project_id: str,
    conversation_id: str,
    run_id: str,
    approval_id: str,
    body: VisualAssistantApprovalIn,
) -> VisualAssistantApprovalOut:
    try:
        await VisualAssistantConversations(session, request.app.state.settings).get(
            project_id, conversation_id
        )
        await request.app.state.assistant_approvals.resolve(
            run_id=run_id,
            approval_id=approval_id,
            scope={"project_id": project_id, "conversation_id": conversation_id},
            decision=body.decision,
            canvas_revision=body.canvas_revision,
        )
    except AssistantNotFoundError as exc:
        raise _translate(exc) from None
    except ApprovalNotFoundError as exc:
        raise HTTPException(404, {"code": "approval_not_found", "message": str(exc)}) from None
    except ApprovalConflictError as exc:
        raise HTTPException(409, {"code": "approval_conflict", "message": str(exc)}) from None
    return VisualAssistantApprovalOut()

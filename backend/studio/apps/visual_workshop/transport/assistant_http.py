"""Visual's published assistant conversation and model option endpoints."""

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from studio.apps.visual_workshop.assistant.assistant_peers import AssistantPeers
from studio.apps.visual_workshop.assistant.assistant_stream import AssistantStream
from studio.apps.visual_workshop.assistant.assistant_submission import AssistantSubmission
from studio.apps.visual_workshop.conversations import Conversations
from studio.apps.visual_workshop.schemas.workshop import (
    VisualAssistantApprovalIn,
    VisualAssistantApprovalOut,
    VisualAssistantConversationListOut,
    VisualAssistantConversationOut,
    VisualAssistantConversationPatchIn,
    VisualAssistantModelOptionListOut,
    VisualAssistantSendIn,
)
from studio.contracts.visual_workshop.visual_assistant import SOURCE
from studio.runtime.http.dependencies import OwnerDep, SessionDep
from studio.runtime.tasks.reactive_tools.approval import (
    ApprovalConflictError,
    ApprovalNotFoundError,
)

router = APIRouter(
    prefix=SOURCE + "/{project_id}/conversations",
    tags=["visual-workshop-assistant"],
)


def conversations(request, session, owner):
    return Conversations(session, owner, AssistantPeers(request, owner))


@router.get("", response_model=VisualAssistantConversationListOut)
async def list_conversations(
    session: SessionDep, project_id: str, request: Request, owner_user_id: OwnerDep
) -> VisualAssistantConversationListOut:
    return await conversations(request, session, owner_user_id).list(project_id)


@router.post("", response_model=VisualAssistantConversationOut)
async def create_conversation(
    session: SessionDep, project_id: str, request: Request, owner_user_id: OwnerDep
) -> VisualAssistantConversationOut:
    return await conversations(request, session, owner_user_id).create(project_id)


@router.get("/models", response_model=VisualAssistantModelOptionListOut)
async def list_models(
    session: SessionDep, project_id: str, request: Request, owner_user_id: OwnerDep
) -> VisualAssistantModelOptionListOut:
    return await conversations(request, session, owner_user_id).model_options(project_id)


@router.get("/{conversation_id}", response_model=VisualAssistantConversationOut)
async def get_conversation(
    session: SessionDep,
    project_id: str,
    conversation_id: str,
    request: Request,
    owner_user_id: OwnerDep,
) -> VisualAssistantConversationOut:
    return await conversations(request, session, owner_user_id).get(project_id, conversation_id)


@router.patch("/{conversation_id}", response_model=VisualAssistantConversationOut)
async def patch_conversation(
    session: SessionDep,
    project_id: str,
    conversation_id: str,
    body: VisualAssistantConversationPatchIn,
    request: Request,
    owner_user_id: OwnerDep,
) -> VisualAssistantConversationOut:
    return await conversations(request, session, owner_user_id).patch(
        project_id, conversation_id, body
    )


@router.delete("/{conversation_id}")
async def delete_conversation(
    session: SessionDep,
    project_id: str,
    conversation_id: str,
    request: Request,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    await conversations(request, session, owner_user_id).delete(
        project_id, conversation_id, expected_revision
    )
    return {"deleted": True}


@router.post("/{conversation_id}/messages/stream")
async def stream_message(
    request: Request,
    session: SessionDep,
    project_id: str,
    conversation_id: str,
    body: VisualAssistantSendIn,
    owner_user_id: OwnerDep,
) -> StreamingResponse:
    state = request.app.state
    if state.assistant_dispatches.peer is None:
        raise HTTPException(503, "visual_assistant_settlement_unavailable")
    submission = AssistantSubmission(request, session, owner_user_id, state.assistant_dispatches)
    turn = await submission.start(project_id, conversation_id, body)
    return StreamingResponse(
        AssistantStream(state, turn, submission.peers).events(),
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
    owner_user_id: OwnerDep,
) -> VisualAssistantApprovalOut:
    await conversations(request, session, owner_user_id).row(project_id, conversation_id)
    await session.rollback()
    assertion = request.state.service_assertion
    active = await request.app.state.snapshot_authorization.status(
        assertion=assertion, method=request.method, path=request.url.path
    )
    if active is not True:
        raise HTTPException(
            401 if active is False else 503, "visual_assistant_approval_authority_ended"
        )
    try:
        await request.app.state.assistant_approvals.resolve(
            run_id=run_id,
            approval_id=approval_id,
            scope={
                "owner_user_id": owner_user_id,
                "project_id": project_id,
                "conversation_id": conversation_id,
            },
            decision=body.decision,
            canvas_revision=body.canvas_revision,
            authorization=assertion,
        )
    except ApprovalNotFoundError as exc:
        raise HTTPException(404, {"code": "approval_not_found", "message": str(exc)}) from None
    except ApprovalConflictError as exc:
        raise HTTPException(409, {"code": "approval_conflict", "message": str(exc)}) from None
    return VisualAssistantApprovalOut()

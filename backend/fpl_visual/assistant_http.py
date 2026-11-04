"""Visual's published assistant conversation and model option endpoints."""

from fastapi import APIRouter, Query, Request

from app.apps.visual_workshop.schemas.workshop import (
    VisualAssistantConversationListOut,
    VisualAssistantConversationOut,
    VisualAssistantConversationPatchIn,
    VisualAssistantModelOptionListOut,
)
from fpl_runtime.http_dependencies import OwnerDep, SessionDep
from fpl_runtime.visual_assistant import SOURCE

from .assistant_peers import AssistantPeers
from .conversations import Conversations

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

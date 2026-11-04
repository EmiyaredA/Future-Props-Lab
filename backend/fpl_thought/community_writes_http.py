"""Published community writes for the independent Thought service."""

from fastapi import APIRouter, Request

from app.apps.thought_workshop.http_bindings import CommunitySessionDep
from app.apps.thought_workshop.publication.schemas import CommunityNote, CommunityNotePut
from app.deps import PublicStudioAuth

from .community_edits import save_note
from .mutations_http import guarded

router = APIRouter(prefix="/thought-workshop/community", tags=["knowledge-community"])


@router.put("/publications/{publication_id}/notes/{note_id}", response_model=CommunityNote)
async def save(
    request: Request,
    publication_id: str,
    note_id: str,
    body: CommunityNotePut,
    session: CommunitySessionDep,
    principal: PublicStudioAuth,
):
    return await guarded(
        save_note(
            session,
            principal,
            publication_id,
            note_id,
            body,
            references=request.app.state.thought_references,
            identity=request.app.state.identity,
            assertion=request.state.service_assertion,
            source_path=request.url.path,
        )
    )

"""Published community writes for the independent Thought service."""

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from studio.apps.thought_workshop.community.community_edits import save_note
from studio.apps.thought_workshop.community.community_upload import upload_attachment
from studio.apps.thought_workshop.http_bindings import CommunitySessionDep
from studio.apps.thought_workshop.multitable.schemas import BatchIn, BatchOut
from studio.apps.thought_workshop.publication.schemas import CommunityNote, CommunityNotePut
from studio.apps.thought_workshop.schemas.workshop import ThoughtAttachmentOut
from studio.apps.thought_workshop.storage.community_tables import apply_table
from studio.apps.thought_workshop.transport.mutations_http import guarded
from studio.apps.thought_workshop.transport.upload_http import guarded_upload
from studio.assembly.http_dependencies import PublicStudioAuth

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


@router.post(
    "/publications/{publication_id}/notes/{note_id}/multitable/operations",
    response_model=BatchOut,
)
async def operations(
    request: Request,
    publication_id: str,
    note_id: str,
    body: BatchIn,
    session: CommunitySessionDep,
    principal: PublicStudioAuth,
    parent_note_id: str | None = None,
):
    return await guarded(
        apply_table(
            session,
            principal,
            publication_id,
            note_id,
            body,
            parent_note_id,
            references=request.app.state.thought_references,
            identity=request.app.state.identity,
            assertion=request.state.service_assertion,
            source_path=request.url.path,
        )
    )


@router.post(
    "/publications/{publication_id}/notes/{note_id}/uploads", response_model=ThoughtAttachmentOut
)
async def upload(
    request: Request,
    publication_id: str,
    note_id: str,
    session: CommunitySessionDep,
    principal: PublicStudioAuth,
    upload: UploadFile = File(),
):
    app = request.app.state
    if app.thought_community_uploads is None:
        await upload.close()
        raise HTTPException(503, "community_upload_unavailable")
    return await guarded_upload(
        upload_attachment(
            session,
            principal,
            publication_id,
            note_id,
            upload,
            request_key=request.headers.get("idempotency-key"),
            maximum_bytes=app.thought_upload_configuration.maximum_bytes,
            delivery=app.thought_community_uploads,
            identity=app.identity,
            assertion=request.state.service_assertion,
        )
    )

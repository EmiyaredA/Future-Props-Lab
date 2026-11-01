from typing import Literal

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError
from starlette.background import BackgroundTask

from app.apps.thought_workshop.assistant import models, prepare, writing_events
from app.apps.thought_workshop.attachments import upload_attachment
from app.apps.thought_workshop.directory import Directory
from app.apps.thought_workshop.knowledge import KnowledgeBases
from app.apps.thought_workshop.link_preview import preview_link
from app.apps.thought_workshop.notes import Notes, ThoughtError, note_out
from app.apps.thought_workshop.operations import apply_operations as thought_operations
from app.apps.thought_workshop.portability import export_backup, import_backup
from app.apps.thought_workshop.routes.knowledge_tools import router as knowledge_tools_router
from app.apps.thought_workshop.schemas.history import ThoughtHistoryDetail, ThoughtHistoryList
from app.apps.thought_workshop.schemas.knowledge import (
    KnowledgeBaseIn,
    KnowledgeBaseOut,
    KnowledgeBasePut,
    KnowledgeNoteCreate,
    ThoughtDirectoryOut,
    ThoughtMoveIn,
)
from app.apps.thought_workshop.schemas.link_preview import ThoughtLinkPreview
from app.apps.thought_workshop.schemas.operations import ThoughtOperationsIn
from app.apps.thought_workshop.schemas.workshop import (
    ThoughtAssistantEvent,
    ThoughtAssistantIn,
    ThoughtAttachmentOut,
    ThoughtImageOut,
    ThoughtImportOut,
    ThoughtModelOut,
    ThoughtNoteCreate,
    ThoughtNoteList,
    ThoughtNoteOut,
    ThoughtNotePut,
    ThoughtNoteTransitionIn,
    ThoughtRevisionIn,
)
from app.capabilities.asset_store.library import AssetError, AssetLibrary
from app.capabilities.asset_store.project_snapshots import ProjectSnapshotError
from app.deps import OwnerDep, SessionDep, StudioAuth
from app.llm.call_logs.credentials import snapshot_from_principal
from app.runtime.config import get_settings
from app.runtime.operation_receipts import OperationError

from .multitable import router as multitable_router

router = APIRouter(prefix="/thought-workshop", tags=["thought-workshop"])


@router.get("/link-preview", response_model=ThoughtLinkPreview)
async def link_preview(_owner_user_id: OwnerDep, url: str = Query(min_length=1, max_length=8192)):
    return await preview_link(url)


async def call(operation):
    try:
        return await operation
    except (ThoughtError, AssetError, ProjectSnapshotError, OperationError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except ValidationError as exc:
        raise HTTPException(
            422, {"code": "invalid_operation_result", "errors": exc.errors(include_context=False)}
        ) from None


@router.get("/notes", response_model=ThoughtNoteList)
async def list_notes(
    session: SessionDep,
    owner_user_id: OwnerDep,
    knowledge_base_id: str,
    query: str = Query(default="", max_length=240),
    parent_id: str = "",
    tag: str = "",
    view: Literal["all", "recent", "favorites", "pinned", "trash"] = "all",
    sort: Literal["updated", "title"] = "updated",
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=40, ge=1, le=100),
):
    return await call(
        Notes(session, owner_user_id).list(
            knowledge_base_id=knowledge_base_id,
            query=query,
            parent_id=parent_id,
            tag=tag,
            view=view,
            sort=sort,
            offset=offset,
            limit=limit,
        )
    )


@router.post("/notes", response_model=ThoughtNoteOut)
async def create_note(body: ThoughtNoteCreate, session: SessionDep, principal: StudioAuth):
    return await call(
        Directory(session, principal.owner_user_id, principal.user_id).create_content(body)
    )


@router.get("/notes/{note_id}", response_model=ThoughtNoteOut)
async def get_note(note_id: str, session: SessionDep, owner_user_id: OwnerDep):
    return note_out(await call(Notes(session, owner_user_id).get(note_id)))


@router.put("/notes/{note_id}", response_model=ThoughtNoteOut)
async def put_note(note_id: str, body: ThoughtNotePut, session: SessionDep, principal: StudioAuth):
    return await call(Notes(session, principal.owner_user_id, principal.user_id).put(note_id, body))


@router.post("/notes/{note_id}/operations", response_model=ThoughtNoteOut)
async def apply_note_operations(
    note_id: str, body: ThoughtOperationsIn, session: SessionDep, principal: StudioAuth
):
    return await call(
        thought_operations(session, principal.owner_user_id, note_id, body, principal.user_id)
    )


@router.get("/notes/{note_id}/history", response_model=ThoughtHistoryList)
async def note_history(
    note_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    cursor: str | None = Query(default=None, max_length=36),
    limit: int = Query(default=30, ge=1, le=100),
):
    return await call(Notes(session, owner_user_id).history_list(note_id, cursor, limit))


@router.get("/notes/{note_id}/history/{history_id}", response_model=ThoughtHistoryDetail)
async def note_history_detail(
    note_id: str, history_id: str, session: SessionDep, owner_user_id: OwnerDep
):
    return await call(Notes(session, owner_user_id).history_detail(note_id, history_id))


@router.post("/notes/{note_id}/history/{history_id}/restore", response_model=ThoughtNoteOut)
async def restore_note_history(
    note_id: str,
    history_id: str,
    body: ThoughtRevisionIn,
    session: SessionDep,
    principal: StudioAuth,
):
    return await call(
        Notes(session, principal.owner_user_id, principal.user_id).restore_history(
            note_id, history_id, body.expected_revision
        )
    )


@router.delete("/notes/{note_id}", response_model=ThoughtNoteOut)
async def delete_note(
    note_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
    permanent: bool = False,
    expected_knowledge_revision: int = Query(ge=0),
    cascade_children: bool = False,
):
    return await call(
        Notes(session, owner_user_id).transition(
            note_id,
            expected_revision,
            "purge" if permanent else "trash",
            expected_knowledge_revision,
            cascade_children=cascade_children,
        )
    )


@router.post("/notes/{note_id}/restore", response_model=ThoughtNoteOut)
async def restore_note(
    note_id: str, body: ThoughtNoteTransitionIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await call(
        Notes(session, owner_user_id).transition(
            note_id, body.expected_revision, "restore", body.expected_knowledge_revision
        )
    )


@router.post("/images", response_model=ThoughtImageOut)
async def upload_image(session: SessionDep, owner_user_id: OwnerDep, upload: UploadFile = File()):
    row = await call(
        AssetLibrary(session, get_settings()).store_upload(
            upload,
            owner_user_id=owner_user_id,
            allowed_extensions={".png", ".jpg", ".jpeg", ".gif", ".webp"},
        )
    )
    return ThoughtImageOut(asset_id=row.id)


@router.get("/models", response_model=list[ThoughtModelOut])
async def writing_models(session: SessionDep, owner_user_id: OwnerDep):
    return await models(Notes(session, owner_user_id))


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
    principal: StudioAuth,
):
    credential = await snapshot_from_principal(session, principal)
    prepared = await call(
        prepare(Notes(session, owner_user_id), note_id, body, credential=credential)
    )
    return StreamingResponse(
        writing_events(prepared),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/backup", response_class=FileResponse)
async def backup(
    session: SessionDep, owner_user_id: OwnerDep, knowledge_base_id: str | None = None
):
    import shutil

    path = await call(
        export_backup(Notes(session, owner_user_id), get_settings(), knowledge_base_id)
    )
    return FileResponse(
        path,
        filename="thought-workshop.zip",
        media_type="application/zip",
        background=BackgroundTask(shutil.rmtree, path.parent, ignore_errors=True),
    )


@router.post("/imports", response_model=ThoughtImportOut)
async def imports(
    session: SessionDep,
    principal: StudioAuth,
    upload: UploadFile = File(),
    knowledge_base_id: str | None = None,
    expected_revision: int | None = Query(default=None, ge=0),
):
    return await call(
        import_backup(
            Notes(session, principal.owner_user_id, principal.user_id),
            get_settings(),
            upload,
            knowledge_base_id,
            expected_revision,
        )
    )


@router.post("/attachments", response_model=ThoughtAttachmentOut)
async def attachments(session: SessionDep, owner_user_id: OwnerDep, upload: UploadFile = File(...)):
    return await call(upload_attachment(session, get_settings(), owner_user_id, upload))


@router.get("/knowledge-bases", response_model=list[KnowledgeBaseOut])
async def knowledge_bases(
    session: SessionDep,
    owner_user_id: OwnerDep,
    query: str = Query(default="", max_length=240),
    trash: bool = False,
):
    return await call(KnowledgeBases(session, owner_user_id).list(query, trash))


@router.post("/knowledge-bases", response_model=KnowledgeBaseOut)
async def create_knowledge_base(body: KnowledgeBaseIn, session: SessionDep, principal: StudioAuth):
    return await call(
        KnowledgeBases(session, principal.owner_user_id, principal.user_id).create(body)
    )


@router.get("/knowledge-bases/{project_id}", response_model=KnowledgeBaseOut)
async def knowledge_base(project_id: str, session: SessionDep, owner_user_id: OwnerDep):
    usecase = KnowledgeBases(session, owner_user_id)
    return await call(usecase.output(await call(usecase.get(project_id))))


@router.put("/knowledge-bases/{project_id}", response_model=KnowledgeBaseOut)
async def update_knowledge_base(
    project_id: str, body: KnowledgeBasePut, session: SessionDep, owner_user_id: OwnerDep
):
    return await call(KnowledgeBases(session, owner_user_id).put(project_id, body))


@router.delete("/knowledge-bases/{project_id}", response_model=KnowledgeBaseOut)
async def trash_knowledge_base(
    project_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
):
    return await call(
        KnowledgeBases(session, owner_user_id).transition(project_id, expected_revision, False)
    )


@router.post("/knowledge-bases/{project_id}/restore", response_model=KnowledgeBaseOut)
async def restore_knowledge_base(
    project_id: str, body: ThoughtRevisionIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await call(
        KnowledgeBases(session, owner_user_id).transition(project_id, body.expected_revision, True)
    )


@router.get("/knowledge-bases/{project_id}/directory", response_model=ThoughtDirectoryOut)
async def directory(project_id: str, session: SessionDep, owner_user_id: OwnerDep):
    return await call(Directory(session, owner_user_id).tree(project_id))


@router.post("/knowledge-bases/{project_id}/documents", response_model=ThoughtNoteOut)
async def create_document(
    project_id: str, body: KnowledgeNoteCreate, session: SessionDep, principal: StudioAuth
):
    return await call(
        Directory(session, principal.owner_user_id, principal.user_id).create_note(project_id, body)
    )


@router.post("/knowledge-bases/{project_id}/move", response_model=ThoughtDirectoryOut)
async def move_entry(
    project_id: str, body: ThoughtMoveIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await call(Directory(session, owner_user_id).move(project_id, body))


router.include_router(knowledge_tools_router)

router.include_router(multitable_router)

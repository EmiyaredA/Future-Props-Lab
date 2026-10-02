from fastapi import APIRouter, HTTPException, Query

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.knowledge_tools.checkpoints import Checkpoints
from app.apps.thought_workshop.knowledge_tools.export_snapshot import export_snapshot
from app.apps.thought_workshop.knowledge_tools.preferences import Preferences
from app.apps.thought_workshop.knowledge_tools.references import backlinks, resolve
from app.apps.thought_workshop.knowledge_tools.reuse import ReusableContent
from app.apps.thought_workshop.knowledge_tools.schemas import (
    CheckpointIn,
    CheckpointOut,
    CheckpointPut,
    DuplicateIn,
    DuplicateOut,
    DuplicateSnapshot,
    LibraryExportSnapshot,
    ReadingIn,
    ReadingOut,
    ReferenceTarget,
    ResolveReferences,
    SavedFilterIn,
    SavedFilterOut,
    SavedFilterPut,
    SearchCriteria,
    SearchResult,
    TemplateApply,
    TemplateIn,
    TemplateOut,
    TemplatePut,
)
from app.apps.thought_workshop.knowledge_tools.search import search
from app.apps.thought_workshop.schemas.workshop import ThoughtNoteOut, ThoughtNoteSummary
from app.deps import SessionDep, StudioAuth, WorkspaceDep

router = APIRouter()


async def call(operation):
    try:
        return await operation
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/search", response_model=SearchResult)
async def global_search(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    query: str = Query(default="", max_length=500),
    knowledge_base_id: str | None = None,
    tag: str = Query(default="", max_length=40),
    favorite: bool = False,
    title_only: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=40, ge=1, le=100),
):
    return await call(
        search(
            session,
            workspace_id,
            SearchCriteria(
                query=query,
                knowledge_base_id=knowledge_base_id,
                tag=tag,
                favorite=favorite,
                title_only=title_only,
            ),
            offset,
            limit,
        )
    )


@router.post("/references/resolve", response_model=list[ReferenceTarget])
async def resolve_references(
    body: ResolveReferences, session: SessionDep, workspace_id: WorkspaceDep
):
    return await call(resolve(session, workspace_id, body.ids))


@router.get("/notes/{note_id}/backlinks", response_model=list[ThoughtNoteSummary])
async def note_backlinks(
    note_id: str,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=40, ge=1, le=100),
):
    return await call(backlinks(session, workspace_id, note_id, offset, limit))


@router.get("/templates", response_model=list[TemplateOut])
async def templates(session: SessionDep, workspace_id: WorkspaceDep):
    return await call(ReusableContent(session, workspace_id).templates())


@router.post("/templates", response_model=TemplateOut)
async def create_template(body: TemplateIn, session: SessionDep, principal: StudioAuth):
    return await call(ReusableContent(session, principal.workspace_id).create_template(body))


@router.put("/templates/{template_id}", response_model=TemplateOut)
async def put_template(
    template_id: str, body: TemplatePut, session: SessionDep, workspace_id: WorkspaceDep
):
    return await call(ReusableContent(session, workspace_id).update_template(template_id, body))


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: str,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    expected_revision: int = Query(ge=0),
):
    await call(
        ReusableContent(session, workspace_id).delete_template(template_id, expected_revision)
    )


@router.post("/templates/{template_id}/apply", response_model=ThoughtNoteOut)
async def apply_template(
    template_id: str, body: TemplateApply, session: SessionDep, principal: StudioAuth
):
    return await call(
        ReusableContent(session, principal.workspace_id, principal.user_id).apply_template(
            template_id, body
        )
    )


@router.get("/notes/{note_id}/copy-snapshot", response_model=DuplicateSnapshot)
async def copy_snapshot(
    note_id: str, session: SessionDep, workspace_id: WorkspaceDep, subtree: bool = False
):
    return await call(ReusableContent(session, workspace_id).copy_snapshot(note_id, subtree))


@router.post("/notes/{note_id}/duplicate", response_model=DuplicateOut)
async def duplicate_document(
    note_id: str, body: DuplicateIn, session: SessionDep, principal: StudioAuth
):
    return await call(
        ReusableContent(session, principal.workspace_id, principal.user_id).duplicate(note_id, body)
    )


@router.get("/notes/{note_id}/checkpoints", response_model=list[CheckpointOut])
async def checkpoints(note_id: str, session: SessionDep, workspace_id: WorkspaceDep):
    return await call(Checkpoints(session, workspace_id).list(note_id))


@router.post("/notes/{note_id}/checkpoints", response_model=CheckpointOut)
async def create_checkpoint(
    note_id: str, body: CheckpointIn, session: SessionDep, workspace_id: WorkspaceDep
):
    return await call(Checkpoints(session, workspace_id).create(note_id, body))


@router.put("/notes/{note_id}/checkpoints/{checkpoint_id}", response_model=CheckpointOut)
async def rename_checkpoint(
    note_id: str,
    checkpoint_id: str,
    body: CheckpointPut,
    session: SessionDep,
    workspace_id: WorkspaceDep,
):
    return await call(
        Checkpoints(session, workspace_id).change(
            note_id, checkpoint_id, body.expected_revision, body.name
        )
    )


@router.delete("/notes/{note_id}/checkpoints/{checkpoint_id}", status_code=204)
async def delete_checkpoint(
    note_id: str,
    checkpoint_id: str,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    expected_revision: int = Query(ge=0),
):
    await call(Checkpoints(session, workspace_id).change(note_id, checkpoint_id, expected_revision))


@router.get("/preferences/filters", response_model=list[SavedFilterOut])
async def saved_filters(session: SessionDep, principal: StudioAuth):
    return await call(Preferences(session, principal.workspace_id, principal.user_id).filters())


@router.post("/preferences/filters", response_model=SavedFilterOut)
async def save_filter(body: SavedFilterIn, session: SessionDep, principal: StudioAuth):
    return await call(
        Preferences(session, principal.workspace_id, principal.user_id).save_filter(body)
    )


@router.put("/preferences/filters/{filter_id}", response_model=SavedFilterOut)
async def put_filter(
    filter_id: str, body: SavedFilterPut, session: SessionDep, principal: StudioAuth
):
    return await call(
        Preferences(session, principal.workspace_id, principal.user_id).save_filter(body, filter_id)
    )


@router.delete("/preferences/filters/{filter_id}", status_code=204)
async def delete_filter(
    filter_id: str, session: SessionDep, principal: StudioAuth, expected_revision: int = Query(ge=0)
):
    await call(
        Preferences(session, principal.workspace_id, principal.user_id).delete_filter(
            filter_id, expected_revision
        )
    )


@router.get("/preferences/recent", response_model=list[ReadingOut])
async def recently_visited(session: SessionDep, principal: StudioAuth):
    return await call(Preferences(session, principal.workspace_id, principal.user_id).recent())


@router.get("/preferences/reading", response_model=ReadingOut | None)
async def reading_position(
    session: SessionDep,
    principal: StudioAuth,
    resource_id: str = Query(min_length=1, max_length=200),
):
    return await call(
        Preferences(session, principal.workspace_id, principal.user_id).reading(resource_id)
    )


@router.post("/preferences/reading", response_model=ReadingOut)
async def record_reading(body: ReadingIn, session: SessionDep, principal: StudioAuth):
    return await call(Preferences(session, principal.workspace_id, principal.user_id).record(body))


@router.get("/knowledge-bases/{project_id}/export-snapshot", response_model=LibraryExportSnapshot)
async def library_export_snapshot(project_id: str, session: SessionDep, workspace_id: WorkspaceDep):
    return await call(export_snapshot(session, workspace_id, project_id))

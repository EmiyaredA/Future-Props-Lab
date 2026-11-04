"""Account-scoped read adapters for the independent Thought service."""

from typing import Literal

from fastapi import APIRouter, Query

from app.apps.thought_workshop.directory import Directory
from app.apps.thought_workshop.http_bindings import SessionDep
from app.apps.thought_workshop.knowledge import KnowledgeBases
from app.apps.thought_workshop.knowledge_tools.reuse import ReusableContent
from app.apps.thought_workshop.knowledge_tools.schemas import TemplateOut
from app.apps.thought_workshop.link_preview import preview_link
from app.apps.thought_workshop.multitable.schemas import (
    ChangeSummary,
    QueryIn,
    RecordPage,
    Snapshot,
    Structure,
)
from app.apps.thought_workshop.multitable.use_cases import Multitable
from app.apps.thought_workshop.notes import Notes, note_out
from app.apps.thought_workshop.schemas.history import ThoughtHistoryDetail, ThoughtHistoryList
from app.apps.thought_workshop.schemas.knowledge import KnowledgeBaseOut, ThoughtDirectoryOut
from app.apps.thought_workshop.schemas.link_preview import ThoughtLinkPreview
from app.apps.thought_workshop.schemas.workshop import ThoughtNoteList, ThoughtNoteOut
from app.deps import OwnerDep, StudioAuth

from .mutations_http import guarded

router = APIRouter(prefix="/thought-workshop", tags=["thought-workshop"])


@router.get("/link-preview", response_model=ThoughtLinkPreview)
async def link_preview(_owner_user_id: OwnerDep, url: str = Query(min_length=1, max_length=8192)):
    return await preview_link(url)


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
    return await guarded(
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


@router.get("/notes/{note_id}", response_model=ThoughtNoteOut)
async def get_note(note_id: str, session: SessionDep, owner_user_id: OwnerDep):
    return note_out(await guarded(Notes(session, owner_user_id).get(note_id)))


@router.get("/notes/{note_id}/history", response_model=ThoughtHistoryList)
async def note_history(
    note_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    cursor: str | None = Query(default=None, max_length=36),
    limit: int = Query(default=30, ge=1, le=100),
):
    return await guarded(Notes(session, owner_user_id).history_list(note_id, cursor, limit))


@router.get("/notes/{note_id}/history/{history_id}", response_model=ThoughtHistoryDetail)
async def note_history_detail(
    note_id: str, history_id: str, session: SessionDep, owner_user_id: OwnerDep
):
    return await guarded(Notes(session, owner_user_id).history_detail(note_id, history_id))


@router.get("/knowledge-bases", response_model=list[KnowledgeBaseOut])
async def knowledge_bases(
    session: SessionDep,
    owner_user_id: OwnerDep,
    query: str = Query(default="", max_length=240),
    trash: bool = False,
):
    return await guarded(KnowledgeBases(session, owner_user_id).list(query, trash))


@router.get("/knowledge-bases/{project_id}", response_model=KnowledgeBaseOut)
async def knowledge_base(project_id: str, session: SessionDep, owner_user_id: OwnerDep):
    usecase = KnowledgeBases(session, owner_user_id)
    return await guarded(usecase.output(await guarded(usecase.get(project_id))))


@router.get("/knowledge-bases/{project_id}/directory", response_model=ThoughtDirectoryOut)
async def directory(project_id: str, session: SessionDep, owner_user_id: OwnerDep):
    return await guarded(Directory(session, owner_user_id).tree(project_id))


@router.get("/templates", response_model=list[TemplateOut])
async def templates(session: SessionDep, owner_user_id: OwnerDep):
    return await guarded(ReusableContent(session, owner_user_id).templates())


@router.get(
    "/notes/{note_id}/multitable",
    response_model=Structure,
    operation_id="structure_v1_thought_workshop_notes__note_id__multitable_get",
)
async def table_structure(note_id: str, session: SessionDep, principal: StudioAuth):
    return await guarded(
        Multitable(session, principal.user_id).structure(
            note_id, "edit" if principal.allows("content.write") else "read"
        )
    )


@router.post(
    "/notes/{note_id}/multitable/tables/{table_id}/query",
    response_model=RecordPage,
    operation_id="records_v1_thought_workshop_notes__note_id__multitable_tables__table_id__query_post",
)
async def table_records(
    note_id: str, table_id: str, body: QueryIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await guarded(Multitable(session, owner_user_id).records(note_id, table_id, body))


@router.get(
    "/notes/{note_id}/multitable/history",
    response_model=list[ChangeSummary],
    operation_id="history_v1_thought_workshop_notes__note_id__multitable_history_get",
)
async def table_history(
    note_id: str, session: SessionDep, owner_user_id: OwnerDep, offset: int = Query(default=0, ge=0)
):
    return await guarded(Multitable(session, owner_user_id).history(note_id, offset))


@router.get(
    "/notes/{note_id}/multitable/history/{revision}",
    response_model=Snapshot,
    operation_id="detail_v1_thought_workshop_notes__note_id__multitable_history__revision__get",
)
async def table_history_detail(
    note_id: str, revision: int, session: SessionDep, owner_user_id: OwnerDep
):
    return await guarded(Multitable(session, owner_user_id).history_snapshot(note_id, revision))

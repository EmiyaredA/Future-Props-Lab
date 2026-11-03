"""Published community reads using Thought-owned state and live Identity directory."""

from fastapi import APIRouter, Query

from app.apps.thought_workshop.http_bindings import CommunitySessionDep
from app.apps.thought_workshop.multitable.schemas import QueryIn, RecordPage, Structure
from app.apps.thought_workshop.publication.schemas import (
    ArticleConfig,
    CommunityArticle,
    CommunityDirectory,
    CommunityNote,
    CommunitySnapshot,
    FavoritesOut,
    PublicationConfig,
    PublicationOut,
)
from app.apps.thought_workshop.publication.tables import CommunityTables
from app.apps.thought_workshop.publication.use_cases import Community
from app.deps import PublicStudioAuth

from .mutations_http import guarded

router = APIRouter(prefix="/thought-workshop/community", tags=["knowledge-community"])


@router.get("/publications", response_model=list[PublicationOut])
async def listing(
    session: CommunitySessionDep,
    principal: PublicStudioAuth,
    query: str = Query(default="", max_length=240),
    official: bool | None = None,
    mine: bool = False,
    favorites: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=24, ge=1, le=48),
):
    return await guarded(
        Community(session, principal).list(query, mine, favorites, offset, limit, official)
    )


@router.get("/libraries/{library_id}/publication", response_model=PublicationConfig)
async def config(library_id: str, session: CommunitySessionDep, principal: PublicStudioAuth):
    return await guarded(Community(session, principal).config(library_id))


@router.get("/publications/{publication_id}", response_model=CommunityDirectory)
async def directory(publication_id: str, session: CommunitySessionDep, principal: PublicStudioAuth):
    return await guarded(Community(session, principal).directory(publication_id))


@router.get("/publications/{publication_id}/notes/{note_id}", response_model=CommunityNote)
async def note(
    publication_id: str, note_id: str, session: CommunitySessionDep, principal: PublicStudioAuth
):
    return await guarded(Community(session, principal).get_note(publication_id, note_id))


@router.get("/publications/{publication_id}/permissions", response_model=list[ArticleConfig])
async def settings(
    publication_id: str,
    session: CommunitySessionDep,
    principal: PublicStudioAuth,
    note_id: list[str] = Query(min_length=1, max_length=2000),
):
    return await guarded(Community(session, principal).settings(publication_id, note_id))


@router.get("/publications/{publication_id}/export-snapshot", response_model=CommunitySnapshot)
async def export(publication_id: str, session: CommunitySessionDep, principal: PublicStudioAuth):
    return await guarded(Community(session, principal).snapshot(publication_id))


@router.get(
    "/publications/{publication_id}/notes/{note_id}/backlinks",
    response_model=list[CommunityArticle],
)
async def backlinks(
    publication_id: str,
    note_id: str,
    session: CommunitySessionDep,
    principal: PublicStudioAuth,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=40, ge=1, le=100),
):
    return await guarded(
        Community(session, principal).backlinks(publication_id, note_id, offset, limit)
    )


@router.get("/favorites", response_model=FavoritesOut)
async def favorites(session: CommunitySessionDep, principal: PublicStudioAuth):
    return await guarded(Community(session, principal).favorites())


@router.get("/publications/{publication_id}/notes/{note_id}/multitable", response_model=Structure)
async def table_structure(
    publication_id: str,
    note_id: str,
    session: CommunitySessionDep,
    principal: PublicStudioAuth,
    parent_note_id: str | None = None,
):
    return await guarded(
        CommunityTables(session, principal).structure(publication_id, note_id, parent_note_id)
    )


@router.post(
    "/publications/{publication_id}/notes/{note_id}/multitable/tables/{table_id}/query",
    response_model=RecordPage,
)
async def table_records(
    publication_id: str,
    note_id: str,
    table_id: str,
    body: QueryIn,
    session: CommunitySessionDep,
    principal: PublicStudioAuth,
    parent_note_id: str | None = None,
):
    return await guarded(
        CommunityTables(session, principal).records(
            publication_id, note_id, table_id, body, parent_note_id
        )
    )

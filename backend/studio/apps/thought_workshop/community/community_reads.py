"""Published community reads using Thought-owned state and live Identity directory."""

from fastapi import APIRouter, Query

from studio.apps.thought_workshop.http_bindings import CommunityDirectoryDep, CommunitySessionDep
from studio.apps.thought_workshop.multitable.schemas import (
    ConversionIn,
    ConversionOut,
    QueryIn,
    RecordPage,
    Structure,
)
from studio.apps.thought_workshop.publication.schemas import (
    ArticleConfig,
    CommunityArticle,
    CommunityDirectory,
    CommunityNote,
    CommunitySnapshot,
    FavoritesOut,
    PublicationConfig,
    PublicationOut,
)
from studio.apps.thought_workshop.publication.tables import CommunityTables
from studio.apps.thought_workshop.publication.use_cases import Community
from studio.apps.thought_workshop.transport.mutations_http import guarded
from studio.assembly.http_dependencies import PublicStudioAuth

router = APIRouter(prefix="/thought-workshop/community", tags=["knowledge-community"])


@router.get("/publications", response_model=list[PublicationOut])
async def listing(
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    query: str = Query(default="", max_length=240),
    official: bool | None = None,
    mine: bool = False,
    favorites: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=24, ge=1, le=48),
):
    return await guarded(
        Community(session, principal, accounts=accounts).list(
            query, mine, favorites, offset, limit, official
        )
    )


@router.get("/libraries/{library_id}/publication", response_model=PublicationConfig)
async def config(
    library_id: str,
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
):
    return await guarded(Community(session, principal, accounts=accounts).config(library_id))


@router.get("/publications/{publication_id}", response_model=CommunityDirectory)
async def directory(
    publication_id: str,
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
):
    return await guarded(Community(session, principal, accounts=accounts).directory(publication_id))


@router.get("/publications/{publication_id}/notes/{note_id}", response_model=CommunityNote)
async def note(
    publication_id: str,
    note_id: str,
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
):
    return await guarded(
        Community(session, principal, accounts=accounts).get_note(publication_id, note_id)
    )


@router.get("/publications/{publication_id}/permissions", response_model=list[ArticleConfig])
async def settings(
    publication_id: str,
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    note_id: list[str] = Query(min_length=1, max_length=2000),
):
    return await guarded(
        Community(session, principal, accounts=accounts).settings(publication_id, note_id)
    )


@router.get("/publications/{publication_id}/export-snapshot", response_model=CommunitySnapshot)
async def export(
    publication_id: str,
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
):
    return await guarded(Community(session, principal, accounts=accounts).snapshot(publication_id))


@router.get(
    "/publications/{publication_id}/notes/{note_id}/backlinks",
    response_model=list[CommunityArticle],
)
async def backlinks(
    publication_id: str,
    note_id: str,
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=40, ge=1, le=100),
):
    return await guarded(
        Community(session, principal, accounts=accounts).backlinks(
            publication_id, note_id, offset, limit
        )
    )


@router.get("/favorites", response_model=FavoritesOut)
async def favorites(
    session: CommunitySessionDep, accounts: CommunityDirectoryDep, principal: PublicStudioAuth
):
    return await guarded(Community(session, principal, accounts=accounts).favorites())


@router.get(
    "/publications/{publication_id}/notes/{note_id}/multitable",
    response_model=Structure,
    operation_id="structure_v1_thought_workshop_community_publications__publication_id__notes__note_id__multitable_get",
    summary="Structure",
)
async def table_structure(
    publication_id: str,
    note_id: str,
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    parent_note_id: str | None = None,
):
    return await guarded(
        CommunityTables(session, principal, accounts=accounts).structure(
            publication_id, note_id, parent_note_id
        )
    )


@router.post(
    "/publications/{publication_id}/notes/{note_id}/multitable/tables/{table_id}/query",
    response_model=RecordPage,
    operation_id="records_v1_thought_workshop_community_publications__publication_id__notes__note_id__multitable_tables__table_id__query_post",
    summary="Records",
)
async def table_records(
    publication_id: str,
    note_id: str,
    table_id: str,
    body: QueryIn,
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    parent_note_id: str | None = None,
):
    return await guarded(
        CommunityTables(session, principal, accounts=accounts).records(
            publication_id, note_id, table_id, body, parent_note_id
        )
    )


@router.post(
    "/publications/{publication_id}/notes/{note_id}/multitable/conversion-preview",
    response_model=ConversionOut,
)
async def conversion(
    publication_id: str,
    note_id: str,
    body: ConversionIn,
    session: CommunitySessionDep,
    accounts: CommunityDirectoryDep,
    principal: PublicStudioAuth,
    parent_note_id: str | None = None,
):
    return await guarded(
        CommunityTables(session, principal, accounts=accounts).conversion(
            publication_id, note_id, body, parent_note_id
        )
    )

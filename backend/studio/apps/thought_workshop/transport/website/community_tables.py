"""Browser Session only; target grants are checked separately from parent grants."""

from fastapi import APIRouter, HTTPException

from app.deps import PublicStudioAuth
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.http_bindings import CommunitySessionDep as SessionDep
from studio.apps.thought_workshop.multitable.schemas import (
    BatchIn,
    BatchOut,
    ConversionIn,
    ConversionOut,
    QueryIn,
    RecordPage,
    Structure,
)
from studio.apps.thought_workshop.publication.tables import CommunityTables

router = APIRouter(
    prefix="/community/publications/{publication_id}/notes/{note_id}/multitable",
    tags=["knowledge-community"],
)


@router.post("/conversion-preview", response_model=ConversionOut)
async def conversion(
    publication_id: str,
    note_id: str,
    body: ConversionIn,
    session: SessionDep,
    principal: PublicStudioAuth,
    parent_note_id: str | None = None,
):
    return await call(
        CommunityTables(session, principal).conversion(
            publication_id, note_id, body, parent_note_id
        )
    )


async def call(operation):
    try:
        return await operation
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("", response_model=Structure)
async def structure(
    publication_id: str,
    note_id: str,
    session: SessionDep,
    principal: PublicStudioAuth,
    parent_note_id: str | None = None,
):
    return await call(
        CommunityTables(session, principal).structure(publication_id, note_id, parent_note_id)
    )


@router.post("/tables/{table_id}/query", response_model=RecordPage)
async def records(
    publication_id: str,
    note_id: str,
    table_id: str,
    body: QueryIn,
    session: SessionDep,
    principal: PublicStudioAuth,
    parent_note_id: str | None = None,
):
    return await call(
        CommunityTables(session, principal).records(
            publication_id, note_id, table_id, body, parent_note_id
        )
    )


@router.post("/operations", response_model=BatchOut)
async def operations(
    publication_id: str,
    note_id: str,
    body: BatchIn,
    session: SessionDep,
    principal: PublicStudioAuth,
    parent_note_id: str | None = None,
):
    return await call(
        CommunityTables(session, principal).apply(publication_id, note_id, body, parent_note_id)
    )

"""Protocol adapters for account-scoped table documents."""

from fastapi import APIRouter, HTTPException, Query

from app.deps import OwnerDep, StudioAuth
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.http_bindings import SessionDep
from studio.apps.thought_workshop.multitable.csv_exchange import import_csv
from studio.apps.thought_workshop.multitable.query_http import router as query_router
from studio.apps.thought_workshop.multitable.schemas import (
    BatchIn,
    BatchOut,
    ChangeSummary,
    CsvIn,
    QueryIn,
    RecordPage,
    RestoreIn,
    Snapshot,
    Structure,
)
from studio.apps.thought_workshop.multitable.use_cases import Multitable

router = APIRouter(prefix="/notes/{note_id}/multitable", tags=["thought-multitable"])


async def call(operation):
    try:
        return await operation
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("", response_model=Structure)
async def structure(note_id: str, session: SessionDep, principal: StudioAuth):
    return await call(
        Multitable(session, principal.owner_user_id).structure(
            note_id, "edit" if principal.allows("content.write") else "read"
        )
    )


@router.post("/tables/{table_id}/query", response_model=RecordPage)
async def records(
    note_id: str, table_id: str, body: QueryIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await call(Multitable(session, owner_user_id).records(note_id, table_id, body))


@router.post("/operations", response_model=BatchOut)
async def operations(note_id: str, body: BatchIn, session: SessionDep, principal: StudioAuth):
    return await call(
        Multitable(session, principal.owner_user_id, principal.user_id).apply(note_id, body)
    )


@router.post("/tables/{table_id}/csv-import", response_model=BatchOut)
async def csv_import(
    note_id: str, table_id: str, body: CsvIn, session: SessionDep, principal: StudioAuth
):
    return await call(
        import_csv(
            Multitable(session, principal.owner_user_id, principal.user_id), note_id, table_id, body
        )
    )


@router.get("/history", response_model=list[ChangeSummary])
async def history(
    note_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    offset: int = Query(default=0, ge=0),
):
    return await call(Multitable(session, owner_user_id).history(note_id, offset))


@router.get("/history/{revision}", response_model=Snapshot)
async def detail(note_id: str, revision: int, session: SessionDep, owner_user_id: OwnerDep):
    return await call(Multitable(session, owner_user_id).history_snapshot(note_id, revision))


@router.post("/history/{revision}/restore", response_model=BatchOut)
async def restore(
    note_id: str, revision: int, body: RestoreIn, session: SessionDep, principal: StudioAuth
):
    return await call(
        Multitable(session, principal.owner_user_id, principal.user_id).restore(
            note_id, revision, body.expected_revision
        )
    )


router.include_router(query_router)

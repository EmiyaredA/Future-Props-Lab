"""Protocol adapters for account-scoped table documents."""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.multitable.csv_exchange import export_csv, import_csv, preview
from app.apps.thought_workshop.multitable.schemas import (
    BatchIn,
    BatchOut,
    ChangeSummary,
    ConversionIn,
    ConversionOut,
    CsvIn,
    CsvPreview,
    CsvSource,
    QueryIn,
    RecordPage,
    RestoreIn,
    Snapshot,
    Structure,
)
from app.apps.thought_workshop.multitable.use_cases import Multitable
from app.deps import OwnerDep, SessionDep, StudioAuth

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


@router.post("/conversion-preview", response_model=ConversionOut)
async def conversion(
    note_id: str, body: ConversionIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await call(Multitable(session, owner_user_id).conversion(note_id, body))


@router.post("/csv-preview", response_model=CsvPreview)
async def csv_preview(note_id: str, body: CsvSource, session: SessionDep, owner_user_id: OwnerDep):
    await call(Multitable(session, owner_user_id).note(note_id))
    try:
        return preview(body)
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post("/tables/{table_id}/csv-import", response_model=BatchOut)
async def csv_import(
    note_id: str, table_id: str, body: CsvIn, session: SessionDep, principal: StudioAuth
):
    return await call(
        import_csv(
            Multitable(session, principal.owner_user_id, principal.user_id), note_id, table_id, body
        )
    )


@router.post("/tables/{table_id}/csv-export")
async def csv_export(
    note_id: str, table_id: str, body: QueryIn, session: SessionDep, owner_user_id: OwnerDep
):
    csv = await call(export_csv(Multitable(session, owner_user_id), note_id, table_id, body))
    return Response(
        csv,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="table.csv"'},
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

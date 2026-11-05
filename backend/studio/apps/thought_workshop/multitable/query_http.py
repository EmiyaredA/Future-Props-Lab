"""Shared account-owned table previews and CSV exports."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.http_bindings import SessionDep
from studio.apps.thought_workshop.multitable.csv_exchange import export_csv, preview
from studio.apps.thought_workshop.multitable.schemas import (
    ConversionIn,
    ConversionOut,
    CsvPreview,
    CsvSource,
    QueryIn,
)
from studio.apps.thought_workshop.multitable.use_cases import Multitable
from studio.assembly.http_dependencies import OwnerDep


async def call(operation):
    try:
        return await operation
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


router = APIRouter()


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

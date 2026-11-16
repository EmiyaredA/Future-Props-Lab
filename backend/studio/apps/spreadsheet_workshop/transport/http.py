"""Thin transport shared by browser and restricted automation clients."""

from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response

from studio.assembly.http_dependencies import OwnerDep

from ..schemas import (
    MAX_UPLOAD,
    SpreadsheetCreate,
    SpreadsheetError,
    SpreadsheetExport,
    SpreadsheetImportConfirm,
    SpreadsheetImportPreview,
    SpreadsheetList,
    SpreadsheetOperations,
    SpreadsheetProject,
    SpreadsheetPut,
    SpreadsheetRange,
)
from ..use_cases import Workbooks

router = APIRouter(prefix="/spreadsheet-workshop", tags=["spreadsheet-workshop"])


def workbooks(request: Request):
    result = getattr(request.app.state, "spreadsheet_workbooks", None)
    if result is None:
        raise HTTPException(
            503, {"code": "service_unavailable", "message": "请通过独立表格服务访问"}
        )
    return result


Books = Annotated[Workbooks, Depends(workbooks)]


@router.get("/projects", response_model=SpreadsheetList, operation_id="list_spreadsheet_projects")
async def list_projects(
    books: Books,
    owner: OwnerDep,
    query: str = Query("", max_length=120),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    return await books.records.list(owner, query, offset, limit)


@router.post(
    "/projects", response_model=SpreadsheetProject, operation_id="create_spreadsheet_project"
)
async def create_project(books: Books, owner: OwnerDep, body: SpreadsheetCreate):
    return await books.records.create(owner, body)


@router.get(
    "/projects/{project_id}",
    response_model=SpreadsheetProject,
    operation_id="get_spreadsheet_project",
)
async def get_project(books: Books, owner: OwnerDep, project_id: str):
    return await books.records.get(owner, project_id)


@router.put(
    "/projects/{project_id}",
    response_model=SpreadsheetProject,
    operation_id="update_spreadsheet_project",
)
async def put_project(books: Books, owner: OwnerDep, project_id: str, body: SpreadsheetPut):
    return await books.records.put(owner, project_id, body)


@router.delete("/projects/{project_id}", operation_id="delete_spreadsheet_project")
async def delete_project(
    books: Books,
    owner: OwnerDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
    request_id: str = Query(min_length=1, max_length=64),
) -> dict[str, bool]:
    return await books.records.delete(owner, project_id, expected_revision, request_id)


@router.post(
    "/projects/{project_id}/operations",
    response_model=SpreadsheetProject,
    operation_id="apply_spreadsheet_operations",
)
async def operations(books: Books, owner: OwnerDep, project_id: str, body: SpreadsheetOperations):
    return await books.records.operations(owner, project_id, body)


@router.get(
    "/projects/{project_id}/range",
    response_model=SpreadsheetRange,
    operation_id="read_spreadsheet_range",
)
async def read_range(
    books: Books,
    owner: OwnerDep,
    project_id: str,
    sheet_id: str = Query(min_length=1, max_length=64),
    range: str = Query(min_length=1, max_length=50),
):
    return await books.read_range(owner, project_id, sheet_id, range)


@router.post(
    "/imports/preview",
    response_model=SpreadsheetImportPreview,
    operation_id="preview_spreadsheet_import",
)
async def preview_import(
    books: Books,
    owner: OwnerDep,
    file: UploadFile = File(),
    encoding: Literal["utf-8-sig", "gb18030"] = Query("utf-8-sig"),
):
    content = bytearray()
    try:
        while chunk := await file.read(1024 * 1024):
            content.extend(chunk)
            if len(content) > MAX_UPLOAD:
                raise SpreadsheetError("文件超过 20 MiB", "upload_limit", 413)
        filename = (file.filename or "workbook.xlsx").replace("\\", "/").rsplit("/", 1)[-1]
        if not filename or len(filename) > 255:
            raise SpreadsheetError("文件名无效")
        return await books.preview(owner, filename, bytes(content), encoding)
    finally:
        await file.close()


@router.post(
    "/imports/{import_id}/confirm",
    response_model=SpreadsheetProject,
    operation_id="confirm_spreadsheet_import",
)
async def confirm_import(
    books: Books, owner: OwnerDep, import_id: str, body: SpreadsheetImportConfirm
):
    return await books.records.confirm(owner, import_id, body)


@router.get(
    "/projects/{project_id}/original",
    operation_id="download_spreadsheet_original",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
async def original(books: Books, owner: OwnerDep, project_id: str):
    path, filename = await books.records.original(owner, project_id)
    return FileResponse(
        path,
        filename=filename,
        media_type="application/octet-stream",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.post(
    "/projects/{project_id}/export",
    operation_id="export_spreadsheet",
    response_class=Response,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
async def export(books: Books, owner: OwnerDep, project_id: str, body: SpreadsheetExport):
    content, media_type = await books.export(owner, project_id, body)
    project = await books.records.get(owner, project_id)
    filename = quote(project.title.replace("/", "_").replace("\\", "_") + "." + body.format)
    return Response(
        content,
        media_type=media_type,
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + filename,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )

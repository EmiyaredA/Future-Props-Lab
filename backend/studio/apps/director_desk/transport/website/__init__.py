from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from studio.apps.director_desk.agent_session import needs_write
from studio.apps.director_desk.files import DirectorDeskFiles
from studio.apps.director_desk.motions import DirectorDeskMotions
from studio.apps.director_desk.projects import DirectorDeskError, DirectorDeskProjects
from studio.apps.director_desk.schemas import (
    DirectorAgentCallComplete,
    DirectorAgentPollOut,
    DirectorAgentSessionOut,
    DirectorFileOut,
    DirectorMotionList,
    DirectorMotionOut,
    DirectorMotionWrite,
    DirectorPendingCall,
    DirectorProjectCreate,
    DirectorProjectList,
    DirectorProjectOut,
    DirectorProjectPatch,
    DirectorToolCall,
    DirectorToolOut,
)
from studio.assembly.http_dependencies import OwnerDep, SessionDep, StudioAuth

router = APIRouter(prefix="/director-desk", tags=["director-desk"])


def storage(request: Request):
    return getattr(request.app.state, "director_storage", None)


def mapped(exc: DirectorDeskError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/projects", response_model=DirectorProjectList)
async def list_projects(
    session: SessionDep,
    owner_user_id: OwnerDep,
    query: str = Query("", max_length=120),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    return await DirectorDeskProjects(session, owner_user_id).list(query, offset, limit)


@router.post("/projects", response_model=DirectorProjectOut, status_code=201)
async def create_project(session: SessionDep, owner_user_id: OwnerDep, body: DirectorProjectCreate):
    return await DirectorDeskProjects(session, owner_user_id).create(body)


@router.get("/projects/{project_id}", response_model=DirectorProjectOut)
async def get_project(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    try:
        return await DirectorDeskProjects(session, owner_user_id).get(project_id)
    except DirectorDeskError as exc:
        raise mapped(exc) from None


@router.patch("/projects/{project_id}", response_model=DirectorProjectOut)
async def patch_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: DirectorProjectPatch,
):
    try:
        return await DirectorDeskProjects(session, owner_user_id).patch(project_id, body)
    except DirectorDeskError as exc:
        raise mapped(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await DirectorDeskProjects(session, owner_user_id).delete(
            project_id, expected_revision, storage=storage(request)
        )
    except DirectorDeskError as exc:
        raise mapped(exc) from None
    return {"deleted": True}


@router.post("/projects/{project_id}/files", response_model=DirectorFileOut)
async def upload_project_file(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    upload: Annotated[UploadFile, File()],
) -> DirectorFileOut:
    try:
        return await DirectorDeskFiles(
            session, owner_user_id, storage=storage(request)
        ).store_project_file(project_id, upload)
    except DirectorDeskError as exc:
        raise mapped(exc) from None


@router.get("/projects/{project_id}/files/{key}")
async def download_project_file(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str, key: str
) -> FileResponse:
    try:
        path = await DirectorDeskFiles(
            session, owner_user_id, storage=storage(request)
        ).project_file(project_id, key)
    except DirectorDeskError as exc:
        raise mapped(exc) from None
    return FileResponse(path, media_type="application/octet-stream")


@router.post("/library/files", response_model=DirectorFileOut)
async def upload_library_file(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    upload: Annotated[UploadFile, File()],
) -> DirectorFileOut:
    try:
        return await DirectorDeskFiles(
            session, owner_user_id, storage=storage(request)
        ).store_library_file(upload)
    except DirectorDeskError as exc:
        raise mapped(exc) from None


@router.get("/library/files/{key}")
async def download_library_file(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, key: str
) -> FileResponse:
    try:
        path = DirectorDeskFiles(session, owner_user_id, storage=storage(request)).library_file(key)
    except DirectorDeskError as exc:
        raise mapped(exc) from None
    return FileResponse(path, media_type="application/octet-stream")


@router.get("/motions", response_model=DirectorMotionList)
async def list_motions(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    query: str = Query("", max_length=100),
) -> DirectorMotionList:
    return await DirectorDeskMotions(session, owner_user_id, storage=storage(request)).list(query)


@router.get("/motions/{motion_key}", response_model=DirectorMotionOut)
async def get_motion(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, motion_key: str
) -> DirectorMotionOut:
    try:
        return await DirectorDeskMotions(session, owner_user_id, storage=storage(request)).get(
            motion_key
        )
    except DirectorDeskError as exc:
        raise mapped(exc) from None


@router.put("/motions/{motion_key}", response_model=DirectorMotionOut)
async def save_motion(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    motion_key: str,
    body: DirectorMotionWrite,
) -> DirectorMotionOut:
    try:
        return await DirectorDeskMotions(session, owner_user_id, storage=storage(request)).save(
            motion_key, body
        )
    except DirectorDeskError as exc:
        raise mapped(exc) from None


@router.delete("/motions/{motion_key}")
async def delete_motion(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, motion_key: str
) -> dict[str, bool]:
    try:
        await DirectorDeskMotions(session, owner_user_id, storage=storage(request)).delete(
            motion_key
        )
    except DirectorDeskError as exc:
        raise mapped(exc) from None
    return {"deleted": True}


async def _release_read(session: SessionDep) -> None:
    await session.rollback()


@router.post("/projects/{project_id}/agent-session", response_model=DirectorAgentSessionOut)
async def claim_agent_session(
    request: Request, session: SessionDep, principal: StudioAuth, project_id: str
) -> DirectorAgentSessionOut:
    await _release_read(session)
    try:
        return DirectorAgentSessionOut(
            session_id=await request.app.state.director_editor.claim(
                principal.owner_user_id, project_id
            )
        )
    except DirectorDeskError as exc:
        raise mapped(exc) from None


@router.delete("/projects/{project_id}/agent-session")
async def release_agent_session(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    project_id: str,
    session_id: str = Query(min_length=16, max_length=64),
) -> dict[str, bool]:
    await _release_read(session)
    try:
        await request.app.state.director_editor.release(
            principal.owner_user_id, project_id, session_id
        )
    except DirectorDeskError as exc:
        raise mapped(exc) from None
    return {"released": True}


@router.get(
    "/projects/{project_id}/agent-session/calls",
    response_model=DirectorAgentPollOut,
)
async def poll_agent_session(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    project_id: str,
    session_id: str = Query(min_length=16, max_length=64),
    wait: float = Query(20, ge=0, le=25),
) -> DirectorAgentPollOut:
    await _release_read(session)
    try:
        call = await request.app.state.director_editor.poll(
            principal.owner_user_id, project_id, session_id, wait
        )
    except DirectorDeskError as exc:
        raise mapped(exc) from None
    if call is None:
        return DirectorAgentPollOut()
    return DirectorAgentPollOut(
        call=DirectorPendingCall(
            id=call.id,
            name=call.name,
            arguments=call.arguments,
            request_id=call.request_id,
        )
    )


@router.post("/projects/{project_id}/agent-session/calls/{call_id}")
async def complete_agent_call(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    project_id: str,
    call_id: str,
    body: DirectorAgentCallComplete,
) -> dict[str, bool]:
    await _release_read(session)
    try:
        await request.app.state.director_editor.complete(
            principal.owner_user_id,
            project_id,
            body.session_id,
            call_id,
            result=body.result,
            error=body.error,
        )
    except DirectorDeskError as exc:
        raise mapped(exc) from None
    return {"accepted": True}


@router.post("/projects/{project_id}/tools", response_model=DirectorToolOut)
async def call_tool(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    project_id: str,
    body: DirectorToolCall,
) -> DirectorToolOut:
    if needs_write(body.name, body.arguments) and not principal.allows("content.write"):
        raise mapped(DirectorDeskError("当前账号角色不允许此操作", 403, "insufficient_permission"))
    await _release_read(session)
    try:
        result = await request.app.state.director_editor.invoke(
            principal.owner_user_id, project_id, body.name, body.arguments, body.request_id
        )
    except DirectorDeskError as exc:
        raise mapped(exc) from None
    return DirectorToolOut(result=result)

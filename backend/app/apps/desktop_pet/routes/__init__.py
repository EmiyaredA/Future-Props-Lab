from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.routing import APIRoute
from starlette.background import BackgroundTask

from app.apps.desktop_pet.chat import DesktopPetChats, abandon_reply, stream_reply
from app.apps.desktop_pet.chat_schemas import (
    PetChatClearIn,
    PetChatMessagesOut,
    PetChatOut,
    PetChatSendIn,
    PetChatSettingsIn,
    PetChatStreamEvent,
)
from app.apps.desktop_pet.projects import DesktopPetProjects, PetNotFound
from app.apps.desktop_pet.schemas import (
    PetCreate,
    PetDocumentOut,
    PetPatch,
    PetProjectOut,
    PetProjectsOut,
    PetSave,
    PetSync,
)
from app.apps.live2d_workshop.public import CharacterSourceMissing
from app.deps import SessionDep, StudioAuth, WorkspaceDep
from app.llm.call_logs.credentials import snapshot_from_principal
from app.runtime.operation_receipts import OperationError


class PetRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request):
            try:
                return await handler(request)
            except (PetNotFound, CharacterSourceMissing) as exc:
                raise HTTPException(404, str(exc)) from None
            except OperationError as exc:
                raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None

        return handle


router = APIRouter(prefix="/desktop-pet", tags=["desktop-pet"], route_class=PetRoute)


@router.get("/projects", response_model=PetProjectsOut)
async def list_projects(session: SessionDep, workspace_id: WorkspaceDep):
    return await DesktopPetProjects(session, workspace_id).list()


@router.post("/projects", response_model=PetProjectOut)
async def create_project(session: SessionDep, workspace_id: WorkspaceDep, body: PetCreate):
    return await DesktopPetProjects(session, workspace_id).create(body)


@router.post("/projects/import-whale", response_model=PetProjectOut)
async def import_whale(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    file: Annotated[UploadFile, File()],
):
    return await DesktopPetProjects(session, workspace_id).import_whale(file)


@router.get("/projects/{project_id}", response_model=PetProjectOut)
async def get_project(session: SessionDep, workspace_id: WorkspaceDep, project_id: str):
    return await DesktopPetProjects(session, workspace_id).get(project_id)


@router.patch("/projects/{project_id}", response_model=PetProjectOut)
async def patch_project(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, body: PetPatch
):
    return await DesktopPetProjects(session, workspace_id).patch(project_id, body)


@router.delete("/projects/{project_id}")
async def delete_project(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    expected_revision: int = Query(alias="expectedRevision", ge=0),
) -> dict[str, bool]:
    await DesktopPetProjects(session, workspace_id).delete(project_id, expected_revision)
    return {"deleted": True}


@router.get("/projects/{project_id}/document", response_model=PetDocumentOut)
async def get_document(session: SessionDep, workspace_id: WorkspaceDep, project_id: str):
    return await DesktopPetProjects(session, workspace_id).document(project_id)


@router.put("/projects/{project_id}/document", response_model=PetDocumentOut)
async def save_document(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, body: PetSave
):
    return await DesktopPetProjects(session, workspace_id).save(project_id, body)


@router.post("/projects/{project_id}/sync-source", response_model=PetDocumentOut)
async def sync_source(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, body: PetSync
):
    return await DesktopPetProjects(session, workspace_id).sync_source(project_id, body)


@router.put(
    "/projects/{project_id}/skins/{skin_id}/replacements/{source_asset_id}",
    response_model=PetDocumentOut,
)
async def upload_skin_replacement(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    skin_id: str,
    source_asset_id: str,
    file: Annotated[UploadFile, File()],
    expected_revision: Annotated[int, Form(alias="expectedRevision", ge=0)],
):
    return await DesktopPetProjects(session, workspace_id).upload_skin(
        project_id, skin_id, source_asset_id, expected_revision, file
    )


@router.get("/projects/{project_id}/assets/{asset_id}/file")
async def asset_file(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, asset_id: str
):
    path = await DesktopPetProjects(session, workspace_id).asset_path(project_id, asset_id)
    return FileResponse(path, media_type="image/png")


@router.get("/projects/{project_id}/chat", response_model=PetChatOut)
async def get_chat(
    session: SessionDep, workspace_id: WorkspaceDep, principal: StudioAuth, project_id: str
):
    return await DesktopPetChats(session, workspace_id, principal.user_id).get(project_id)


@router.patch("/projects/{project_id}/chat", response_model=PetChatOut)
async def update_chat(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    principal: StudioAuth,
    project_id: str,
    body: PetChatSettingsIn,
):
    return await DesktopPetChats(session, workspace_id, principal.user_id).settings(
        project_id, body
    )


@router.get("/projects/{project_id}/chat/messages", response_model=PetChatMessagesOut)
async def chat_messages(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    principal: StudioAuth,
    project_id: str,
    before: int | None = Query(None, ge=1),
    limit: int = Query(50, ge=1, le=100),
):
    return await DesktopPetChats(session, workspace_id, principal.user_id).messages(
        project_id, before, limit
    )


@router.delete("/projects/{project_id}/chat/messages", response_model=PetChatOut)
async def clear_chat(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    principal: StudioAuth,
    project_id: str,
    body: PetChatClearIn,
):
    return await DesktopPetChats(session, workspace_id, principal.user_id).clear(project_id, body)


@router.post(
    "/projects/{project_id}/chat/messages/stream",
    responses={
        200: {
            "content": {
                "text/event-stream": {
                    "schema": PetChatStreamEvent.model_json_schema(
                        ref_template="#/components/schemas/{model}"
                    )
                }
            }
        }
    },
)
async def send_chat_message(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    principal: StudioAuth,
    project_id: str,
    body: PetChatSendIn,
):
    credential = await snapshot_from_principal(session, principal)
    prepared = await DesktopPetChats(session, workspace_id, principal.user_id).prepare_send(
        project_id, body, credential
    )
    return StreamingResponse(
        stream_reply(prepared),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        background=BackgroundTask(abandon_reply, prepared),
    )

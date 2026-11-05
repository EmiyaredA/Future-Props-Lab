from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from studio.apps.agent_workbench import reading, sources
from studio.apps.agent_workbench.attachments import attachment_reference
from studio.apps.agent_workbench.schemas import (
    WorkbenchCandidate,
    WorkbenchEvent,
    WorkbenchHistory,
    WorkbenchOperationOut,
    WorkbenchPreferences,
    WorkbenchSessionOut,
    WorkbenchSessionPage,
    WorkbenchSourceCreate,
    WorkbenchSourceOut,
    WorkbenchSourcePatch,
)
from studio.contracts.identity.permissions import CLOUD_CONTROL_PERMISSION
from studio.runtime.http.website import require_local_browser


def create_router(*, SessionDep, StudioAuth, OwnerDep) -> APIRouter:
    """Build one protocol with the owning entry's explicit identity/session dependencies."""

    async def require_workbench_session(principal: StudioAuth, session: SessionDep):
        if principal.auth_kind != "session":
            raise HTTPException(403, "工作台必须使用浏览器 Session")
        if not principal.allows(CLOUD_CONTROL_PERMISSION):
            raise HTTPException(403, "云控仅限管理员访问")
        await session.rollback()
        return principal

    def require_local_source_access(request: Request, principal: StudioAuth):
        require_local_browser(request, principal)

    async def reauthorize_native(request: Request):
        reauthorize = getattr(request.app.state, "workbench_reauthorize", None)
        if reauthorize is not None:
            await reauthorize(request)
        elif getattr(request.app.state, "service_id", None) == "agents":
            raise HTTPException(503, "工作台身份复核能力不可用")

    WorkbenchAuth = Annotated[object, Depends(require_workbench_session)]
    router = APIRouter(
        prefix="/agent-workbench",
        tags=["agent-workbench"],
        dependencies=[Depends(require_workbench_session)],
    )

    @router.get(
        "/candidates",
        response_model=list[WorkbenchCandidate],
        dependencies=[Depends(require_local_source_access)],
    )
    async def list_candidates(request: Request, owner: OwnerDep):
        result = await request.app.state.workbench_native.candidates(owner=owner)
        await reauthorize_native(request)
        return result

    @router.get("/sources", response_model=list[WorkbenchSourceOut])
    async def list_sources(session: SessionDep, owner: OwnerDep):
        return await sources.list_sources(session, owner)

    @router.post(
        "/sources",
        response_model=WorkbenchSourceOut,
        status_code=201,
        dependencies=[Depends(require_local_source_access)],
    )
    async def create_source(
        request: Request, body: WorkbenchSourceCreate, session: SessionDep, owner: OwnerDep
    ):
        try:
            location = await request.app.state.workbench_native.location(body, owner=owner)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        await reauthorize_native(request)
        return await sources.create_source(
            session, owner, body, location=location, enabled=request.app.state.workbench_enabled()
        )

    @router.patch("/sources/{source_id}", response_model=WorkbenchSourceOut)
    async def patch_source(
        source_id: str, body: WorkbenchSourcePatch, session: SessionDep, owner: OwnerDep
    ):
        return await sources.patch_source(session, owner, source_id, body)

    @router.delete("/sources/{source_id}", status_code=204)
    async def unbind_source(
        source_id: str, session: SessionDep, owner: OwnerDep, expected_revision: int = Query(ge=0)
    ):
        await sources.patch_source(
            session,
            owner,
            source_id,
            WorkbenchSourcePatch(expected_revision=expected_revision),
            unbind=True,
        )
        return Response(status_code=204)

    @router.post("/sources/{source_id}/scan", response_model=WorkbenchOperationOut, status_code=202)
    async def scan_source(source_id: str, session: SessionDep, owner: OwnerDep):
        return await sources.scan_source(session, owner, source_id)

    @router.get("/operations/{operation_id}", response_model=WorkbenchOperationOut)
    async def get_operation(operation_id: str, session: SessionDep, owner: OwnerDep):
        return await sources.get_operation(session, owner, operation_id)

    @router.get("/sessions", response_model=WorkbenchSessionPage)
    async def list_sessions(
        session: SessionDep,
        owner: OwnerDep,
        q: str = Query(default="", max_length=200),
        agent_id: str | None = None,
        origin: str | None = None,
        project: str | None = None,
        archived: bool | None = None,
        favorite: bool = False,
        cursor: str | None = Query(default=None, max_length=1000),
        limit: int = Query(default=50, ge=1, le=100),
    ):
        return await reading.list_conversations(
            session,
            owner,
            q=q,
            agent_id=agent_id,
            origin=origin,
            project=project,
            archived=archived,
            favorite=favorite,
            cursor=cursor,
            limit=limit,
        )

    @router.get("/sessions/{session_id}", response_model=WorkbenchSessionOut)
    async def get_session(session_id: str, session: SessionDep, owner: OwnerDep):
        return await reading.session_out(
            session, await reading.get_conversation(session, owner, session_id)
        )

    @router.get("/sessions/{session_id}/history", response_model=WorkbenchHistory)
    async def history(
        session_id: str,
        session: SessionDep,
        owner: OwnerDep,
        before: int | None = Query(default=None, ge=0),
        limit: int = Query(default=50, ge=1, le=100),
        branch: str | None = None,
        before_native_id: str | None = Query(default=None, max_length=255),
    ):
        return await reading.history(
            session,
            owner,
            session_id,
            before=before,
            limit=limit,
            branch=branch,
            before_native_id=before_native_id,
        )

    @router.get("/sessions/{session_id}/attachments/{attachment_id}")
    async def get_attachment(
        request: Request, session_id: str, attachment_id: str, session: SessionDep, owner: OwnerDep
    ):
        from urllib.parse import quote

        roots, reference = await attachment_reference(session, owner, session_id, attachment_id)
        try:
            data, filename = await request.app.state.workbench_native.attachment(
                roots, reference, owner=owner
            )
        except (OSError, ValueError) as exc:
            raise HTTPException(404, "原生附件不在已授权来源范围内或已不可用") from exc
        await reauthorize_native(request)
        return Response(
            data,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": "attachment; filename*=UTF-8''" + quote(filename),
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "no-store",
            },
        )

    @router.patch("/sessions/{session_id}/preferences", response_model=WorkbenchSessionOut)
    async def patch_preferences(
        session_id: str, body: WorkbenchPreferences, session: SessionDep, owner: OwnerDep
    ):
        return await reading.preferences(session, owner, session_id, body)

    @router.delete("/sessions/{session_id}/copy", status_code=204)
    async def clear_copy(
        session_id: str, session: SessionDep, owner: OwnerDep, expected_revision: int = Query(ge=0)
    ):
        await reading.clear_copy(session, owner, session_id, expected_revision)
        return Response(status_code=204)

    def event_response(request, principal, after, session_id=None):
        supplied = request.headers.get("last-event-id")
        if supplied:
            try:
                after = int(supplied)
                if after < 0:
                    raise ValueError
            except ValueError as exc:
                raise HTTPException(422, "事件游标无效") from exc
        stream = request.app.state.workbench_event_stream
        return StreamingResponse(
            stream(request, principal, after, session_id),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )

    @router.get(
        "/events",
        response_class=StreamingResponse,
        responses={
            200: {"content": {"text/event-stream": {"schema": WorkbenchEvent.model_json_schema()}}}
        },
    )
    async def events(
        request: Request, principal: WorkbenchAuth, after: int = Query(default=0, ge=0)
    ):
        return event_response(request, principal, after)

    @router.get(
        "/sessions/{session_id}/events",
        response_class=StreamingResponse,
        responses={
            200: {"content": {"text/event-stream": {"schema": WorkbenchEvent.model_json_schema()}}}
        },
    )
    async def session_events(
        request: Request,
        session_id: str,
        session: SessionDep,
        owner: OwnerDep,
        principal: WorkbenchAuth,
        after: int = Query(default=0, ge=0),
    ):
        await reading.get_conversation(session, owner, session_id)
        await session.rollback()
        return event_response(request, principal, after, session_id)

    return router

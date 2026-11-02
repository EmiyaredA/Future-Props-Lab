"""Public management protocol. Browser and SDK callers cannot supply host paths or commands."""

from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request

from fpl_runtime.http_dependencies import StudioAuth
from fpl_runtime.native_queue import NativeQueueError
from fpl_runtime.service_status import DeploymentServicesOut

from .contracts import (
    ApplicationState,
    EndpointState,
    ManagementAccessAction,
    ManagementApplicationAction,
    ManagementJob,
    RuntimeContext,
    RuntimeLogs,
)
from .operations import authorize, enqueue, job, observation

router = APIRouter(prefix="/v1/management", tags=["management"])


@router.get("/service-status", response_model=DeploymentServicesOut)
async def service_status(request: Request, principal: StudioAuth):
    if principal.auth_kind != "session":
        raise HTTPException(403, "browser_session_required")
    value = await observation(request.app.state.database)
    return DeploymentServicesOut(observed_at=value.observed_at or None, services=value.services)


@router.get("/runtime", response_model=RuntimeContext)
async def runtime(request: Request):
    actor = await authorize(request)
    return {"local_browser": actor.local}


@router.get("/application", response_model=ApplicationState)
async def application(request: Request):
    await authorize(request)
    return (await observation(request.app.state.database)).application


@router.post("/application/actions", response_model=ManagementJob, status_code=202)
async def application_action(request: Request, body: ManagementApplicationAction):
    return await enqueue(
        request, "management.application", {"action": body.action}, body.request_id
    )


@router.get("/application/logs", response_model=RuntimeLogs)
async def application_logs(request: Request):
    accepted = await enqueue(request, "management.logs", {}, uuid4())
    try:
        result = await request.app.state.native_queue.wait(
            owner=request.state.service_actor.user_id, job_id=accepted["id"], timeout=5
        )
    except NativeQueueError:
        raise HTTPException(503, "host_logs_unavailable") from None
    await authorize(request, local=True)
    if result["status"] != "completed":
        raise HTTPException(503, "host_logs_unavailable")
    return result["result"]


@router.get("/access/{target}", response_model=EndpointState)
async def access(request: Request, target: Literal["business", "management"]):
    await authorize(request)
    return getattr(await observation(request.app.state.database), target)


@router.post("/access/{target}/actions", response_model=ManagementJob, status_code=202)
async def access_action(
    request: Request, target: Literal["business", "management"], body: ManagementAccessAction
):
    return await enqueue(
        request, "management.access", {"target": target, "action": body.action}, body.request_id
    )


@router.get("/jobs/{job_id}", response_model=ManagementJob)
async def read_job(request: Request, job_id: UUID):
    return await job(request, job_id)

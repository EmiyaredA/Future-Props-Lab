"""HTTP lifecycle adapter for a model operation's quota reservation."""

from fastapi import Depends, HTTPException, Request
from pydantic import ValidationError

from app.capabilities.identity.route_permissions import route_permission
from app.console.governance.runtime_quotas import acquire, admit_spawned_tasks, attach, release
from app.deps import SessionDep, StudioAuth
from app.llm.inference.tasks import InferenceTasks
from app.runtime.operation_receipts import OperationError
from app.schemas.model_inference import InferenceTaskIn


async def model_capacity(request: Request, principal: StudioAuth, session: SessionDep):
    path = request.url.path
    diagnostic = request.method == "POST" and (
        (path.startswith("/v1/model-entries/") and path.endswith("/test"))
        or (
            path.startswith(("/v1/integrations/tool-apis/", "/v1/integrations/mcp/"))
            and path.endswith("/validate")
        )
        or (path.startswith("/v1/model-test/tools/") and path.endswith("/execute"))
    )
    if route_permission(request.method, request.url.path) != "models.use" and not diagnostic:
        yield
        return
    # A durable receipt does not submit another task or consume another quota slot.
    if request.method == "POST" and path == "/v1/model-inference/tasks":
        try:
            body = InferenceTaskIn.model_validate(await request.json())
        except (ValidationError, ValueError):
            body = None  # The endpoint reports normal request validation errors.
        if body is not None:
            try:
                prior = await InferenceTasks(session, principal.workspace_id).replay(body)
            except OperationError as exc:
                raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
            if prior is not None:
                yield
                return
    # Settle the authentication read transaction before taking a separate writer lock.
    await session.commit()
    weight = 1
    if request.url.path.endswith("/generation-batches"):
        body = await request.json()
        weight = body.get("grid_size", 1) if body.get("grid_size") in (4, 9) else 1
    lease_id = await acquire(principal, weight=weight)
    request.state.model_admission_id = lease_id
    try:
        yield
    finally:
        await session.rollback()
        await release(lease_id)


def task_admission(request: Request, session, kind: str):
    async def retain(task_ids: list[str]):
        await attach(session, getattr(request.state, "model_admission_id", None), kind, task_ids)

    return retain


ModelCapacity = Depends(model_capacity)


def spawned_task_admission(principal, kind):
    async def admit(session, task_ids):
        await admit_spawned_tasks(session, principal, kind, task_ids)

    return admit

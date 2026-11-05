"""HTTP lifecycle adapter for a model operation's quota reservation."""

from fastapi import Depends, HTTPException, Request
from pydantic import ValidationError

from app.deps import SessionDep, StudioAuth
from app.llm.admission import admission_for
from app.llm.inference.receipts import replay_task
from app.llm.schemas.model_inference import InferenceTaskIn
from app.runtime.operation_receipts import OperationError
from studio.contracts.identity.route_permissions import route_permission


async def model_capacity(request: Request, principal: StudioAuth, session: SessionDep):
    path = request.url.path
    diagnostic = request.method == "POST" and (
        (path.startswith("/v1/model-entries/") and path.endswith("/test"))
        or (
            path.startswith(("/v1/integrations/tool-apis/", "/v1/integrations/mcp/"))
            and path.endswith("/validate")
        )
    )
    if route_permission(request.method, request.url.path) != "models.use" and not diagnostic:
        yield
        return
    admission = admission_for(request)
    if request.method == "POST" and path.startswith("/v1/visual-workshop/projects/"):
        body = await request.json()
        if isinstance(body, dict) and (
            path.endswith("/generation-batches")
            or (path.endswith("/generation-tasks") and body.get("kind") in {"image", "video"})
        ):
            # Persist ownership with the tasks, under their creation writer transaction.
            await session.commit()
            request.state.visual_queue_principal = principal
            try:
                yield
            finally:
                await session.rollback()
            return
    # A durable receipt does not submit another task or consume another quota slot.
    if request.method == "POST" and path == "/v1/model-inference/tasks":
        try:
            body = InferenceTaskIn.model_validate(await request.json())
        except (ValidationError, ValueError):
            body = None  # The endpoint reports normal request validation errors.
        if body is not None:
            try:
                prior = await replay_task(session, principal.owner_user_id, body)
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
    lease_id = await admission.acquire(principal, weight=weight)
    request.state.model_admission_id = lease_id
    try:
        yield
    finally:
        try:
            await session.rollback()
        finally:
            await admission.release(lease_id)


def task_admission(request: Request, session, kind: str):
    admission = admission_for(request)

    async def retain(task_ids: list[str]):
        principal = getattr(request.state, "visual_queue_principal", None)
        if principal is not None:
            await admission.admit_tasks(session, principal, kind, task_ids)
        else:
            await admission.attach(
                session, getattr(request.state, "model_admission_id", None), kind, task_ids
            )

    return retain


ModelCapacity = Depends(model_capacity)


def spawned_task_admission(connection, principal, kind):
    admission = admission_for(connection)

    async def admit(session, task_ids):
        await admission.admit_tasks(session, principal, kind, task_ids)

    return admit

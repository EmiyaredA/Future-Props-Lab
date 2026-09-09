"""HTTP lifecycle adapter for a model operation's quota reservation."""

from fastapi import Depends, Request

from app.accounts.route_permissions import route_permission
from app.accounts.runtime_quotas import acquire, attach, release
from app.deps import SessionDep, StudioAuth


async def model_capacity(request: Request, principal: StudioAuth, session: SessionDep):
    diagnostic = request.method == "POST" and (
        request.url.path.endswith("/test")
        or request.url.path.endswith("/validate")
        or request.url.path.endswith("/execute")
    )
    if route_permission(request.method, request.url.path) != "models.use" and not diagnostic:
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

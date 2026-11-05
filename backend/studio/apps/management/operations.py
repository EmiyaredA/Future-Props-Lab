"""Persistent command acceptance and fresh authorization before native execution."""

from datetime import timedelta

import jwt
from fastapi import HTTPException
from sqlalchemy import select

from studio.apps.management.storage.service_models import HostSnapshot, NativeJob
from studio.contracts.identity.claims import verify_context
from studio.runtime.tasks.native_queue import NativeQueueError, snapshot
from studio.runtime.time import utc_now

from .contracts import HostState


async def authorize(request, *, local=False, recent=False):
    actor = request.state.service_actor
    if (
        actor.purpose != "management"
        or actor.auth_kind != "session"
        or actor.platform_role != "admin"
    ):
        raise HTTPException(403, "management_session_required")
    if local and not actor.local:
        raise HTTPException(403, "local_management_required")
    if recent:
        from datetime import datetime

        if not actor.reauthenticated_at or utc_now() - datetime.fromisoformat(
            actor.reauthenticated_at
        ).replace(tzinfo=None) > timedelta(minutes=10):
            raise HTTPException(403, "reauthentication_required")
    if not await request.app.state.identity.active(
        assertion=request.state.service_assertion, method=request.method, path=request.url.path
    ):
        raise HTTPException(401, "management_session_expired")
    return actor


async def enqueue(request, command, arguments, request_id):
    actor = await authorize(request, local=True, recent=True)

    async def existing():
        async with request.app.state.database.sessions() as session:
            session.info["owner_user_id"] = actor.user_id
            row = await session.scalar(
                select(NativeJob).where(NativeJob.request_id == str(request_id))
            )
            if row is None:
                return None
            if row.operation != command or row.payload["arguments"] != arguments:
                raise HTTPException(409, "management_request_conflict")
            return snapshot(row)

    previous = await existing()
    if previous:
        return previous
    try:
        return await request.app.state.native_queue.enqueue(
            owner=actor.user_id,
            operation=command,
            payload={
                "assertion": request.state.service_assertion,
                "method": request.method,
                "path": request.url.path,
                "arguments": arguments,
            },
            request_id=str(request_id),
        )
    except NativeQueueError as exc:
        previous = await existing()
        if previous:
            return previous
        raise HTTPException(409, exc.code) from exc


async def job(request, job_id):
    actor = await authorize(request, local=True)
    try:
        return await request.app.state.native_queue.get(owner=actor.user_id, job_id=str(job_id))
    except NativeQueueError as exc:
        raise HTTPException(404, exc.code) from exc


async def observation(database):
    async with database.sessions() as session:
        row = await session.get(HostSnapshot, "host")
        if row is None or not timedelta(0) <= utc_now() - row.observed_at <= timedelta(seconds=20):
            return HostState()
        return HostState.model_validate(row.payload)


async def report(database, value):
    value.observed_at = utc_now().isoformat()
    async with database.sessions() as session:
        row = await session.get(HostSnapshot, "host")
        if row is None:
            session.add(HostSnapshot(id="host", payload=value.model_dump(mode="json")))
        else:
            row.payload = value.model_dump(mode="json")
            row.observed_at = utc_now()
        await session.commit()


async def validate_lease(app, worker, lease):
    async with app.database.sessions() as session:
        session.info["owner_user_id"] = lease.owner_user_id
        row = await session.scalar(select(NativeJob).where(NativeJob.id == str(lease.job_id)))
        if (
            not row
            or row.worker_id != worker
            or row.lease_id != str(lease.lease_id)
            or row.status != "leased"
            or row.lease_expires_at <= utc_now()
            or row.payload != lease.payload
            or row.operation != lease.operation
        ):
            raise HTTPException(410, "management_lease_ended")
    payload = lease.payload
    try:
        actor = verify_context(
            payload["assertion"],
            service="management",
            method=payload["method"],
            path=payload["path"],
            public_key=app.public_key,
            allow_expired=True,
        )
    except (jwt.InvalidTokenError, ValueError, KeyError, TypeError):
        raise HTTPException(403, "invalid_management_authorization") from None
    if (
        actor.purpose != "management"
        or actor.platform_role != "admin"
        or not actor.local
        or actor.user_id != lease.owner_user_id
        or actor.auth_kind != "session"
    ):
        raise HTTPException(403, "invalid_management_authorization")
    from datetime import datetime

    if not actor.reauthenticated_at or utc_now() - datetime.fromisoformat(
        actor.reauthenticated_at
    ).replace(tzinfo=None) > timedelta(minutes=10):
        raise HTTPException(403, "reauthentication_required")
    if not await app.identity.active(
        assertion=payload["assertion"], method=payload["method"], path=payload["path"]
    ):
        raise HTTPException(403, "management_session_expired")
    return True

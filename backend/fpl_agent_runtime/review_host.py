"""Own one leased native review per Visual run and recheck source authority."""

from contextlib import asynccontextmanager
from datetime import timedelta

import httpx
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text

from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.framed_media import SIZE
from fpl_runtime.native_protocol import NativeLease
from fpl_runtime.native_queue import NativeQueue, NativeQueueError, digest
from fpl_runtime.visual_agent_report import validate_report
from fpl_runtime.visual_agent_review import (
    ASSET_PURPOSE,
    OPERATION,
    STATUS_PURPOSE,
    AgentReviewPlan,
    AgentReviewReceipt,
    frame_target,
)

from .models import VisualReviewJob
from .review_artifacts import RECOVERY_GRACE

OPERATIONS = frozenset({OPERATION})


def unavailable():
    return HTTPException(503, "visual_review_worker_unavailable")


class ReviewHost:
    def __init__(self, database, identity, capabilities):
        self.database, self.identity, self.capabilities = database, identity, capabilities
        self.queue = NativeQueue(database, VisualReviewJob, operations=OPERATIONS, clock=utc_now)

    async def submit(self, owner, assertion, plan):
        if self.identity is None:
            raise unavailable()
        if not await self.active(assertion, plan):
            raise HTTPException(403, "visual_review_authority_ended")
        async with self.database.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            job = await db.scalar(
                select(VisualReviewJob).where(VisualReviewJob.request_id == plan.run_id)
            )
            if job is None:
                now = utc_now()
                if not now < plan.deadline <= now + timedelta(minutes=15):
                    raise HTTPException(409, "visual_review_deadline_invalid")
                job = VisualReviewJob(
                    owner_user_id=owner,
                    operation=OPERATION,
                    request_id=plan.run_id,
                    payload_sha256=plan.digest,
                    payload={"plan": plan.model_dump(mode="json"), "assertion": assertion},
                )
                db.add(job)
                await db.flush()
            elif job.payload_sha256 != plan.digest:
                raise HTTPException(409, "visual_review_request_conflict")
            identity = job.id
            await db.commit()
        return await self.queue.get(owner=owner, job_id=identity)

    async def claim(self, worker):
        lease = await self.queue.claim(worker_id=worker, allowed_operations=OPERATIONS)
        if lease is None:
            return None
        return lease.model_copy(update={"payload": lease.payload["plan"]})

    async def leased(self, worker, lease, *, for_execution):
        async with self.database.sessions(info={"owner_user_id": lease.owner_user_id}) as db:
            row = await db.get(VisualReviewJob, str(lease.job_id))
            if (
                row is None
                or row.worker_id != worker
                or row.lease_id != str(lease.lease_id)
                or row.operation != lease.operation
                or row.payload["plan"] != lease.payload
            ):
                raise HTTPException(410, "visual_review_lease_ended")
            plan = AgentReviewPlan.model_validate(row.payload["plan"])
            if for_execution and (
                row.status != "leased"
                or row.lease_expires_at <= utc_now()
                or plan.deadline <= utc_now()
            ):
                raise HTTPException(410, "visual_review_lease_ended")
            return row.payload["assertion"], plan, row.outcome_sha256

    async def artifact_lease(self, worker, job_id, lease_id):
        async with self.database.sessions(info={"allow_system_reads": True}) as db:
            job = await db.scalar(
                select(VisualReviewJob).where(
                    VisualReviewJob.id == str(job_id),
                    VisualReviewJob.lease_id == str(lease_id),
                    VisualReviewJob.worker_id == worker,
                    VisualReviewJob.status == "leased",
                )
            )
            if job is None:
                raise HTTPException(410, "visual_review_lease_ended")
            return NativeLease(
                job_id=job.id,
                lease_id=job.lease_id,
                owner_user_id=job.owner_user_id,
                operation=job.operation,
                lease_expires_at=job.lease_expires_at.isoformat(),
                payload=job.payload["plan"],
            )

    async def authorize(self, worker, lease):
        assertion, plan, _settled = await self.leased(worker, lease, for_execution=True)
        if not await self.active(assertion, plan):
            raise HTTPException(403, "visual_review_authority_ended")
        if not await self.queue.heartbeat(worker_id=worker, lease=lease):
            raise HTTPException(410, "visual_review_lease_ended")
        return assertion, plan

    async def active(self, assertion, plan):
        if self.identity is None:
            raise unavailable()
        result = await self.identity.status(assertion=assertion, method="POST", path=plan.path)
        if result is None:
            raise unavailable()
        if result is False:
            return result
        try:
            token = await self.authorize_peer(
                assertion, plan, STATUS_PURPOSE, "visual", "GET", plan.status_path
            )
            reply = await self.capabilities.client.get(
                "http://visual:8080" + plan.status_path, headers={HEADER: token}
            )
            if reply.status_code in (401, 403, 404):
                return False
            reply.raise_for_status()
            return reply.json()["active"] is True
        except CapabilityDenied:
            return False
        except (CapabilityUnavailable, httpx.HTTPError, KeyError, ValueError) as exc:
            raise unavailable() from exc

    async def authorize_peer(self, assertion, plan, purpose, service, method, path):
        return await self.capabilities.authorize_request(
            assertion,
            RequestGrant("agent-runtime", purpose, "POST", plan.path, service, method, path),
        )

    @asynccontextmanager
    async def media(self, worker, lease):
        assertion, plan = await self.authorize(worker, lease)
        try:
            token = await self.authorize_peer(
                assertion, plan, ASSET_PURPOSE, "assets", "POST", plan.media_path
            )
            async with self.capabilities.client.stream(
                "POST",
                "http://assets:8080" + plan.media_path,
                headers={HEADER: token, "Accept-Encoding": "identity"},
                json=plan.model_dump(mode="json"),
                timeout=httpx.Timeout(300, connect=5),
            ) as response:
                if response.status_code in (401, 403, 404, 409):
                    raise HTTPException(response.status_code, "visual_review_media_changed")
                response.raise_for_status()
                size = sum(SIZE.size + file.byte_size for file in plan.files)
                if (
                    response.headers.get("Content-Type") != "application/octet-stream"
                    or response.headers.get("Content-Encoding", "identity") != "identity"
                    or int(response.headers["Content-Length"]) != size
                ):
                    raise ValueError("unexpected review media length")
                yield response, size
        except CapabilityDenied as exc:
            raise HTTPException(exc.status, "visual_review_media_denied") from exc
        except (httpx.HTTPError, CapabilityUnavailable, KeyError, ValueError) as exc:
            raise unavailable() from exc

    async def frame(self, owner, assertion, path):
        if self.identity is None:
            raise unavailable()
        active = await self.identity.status(assertion=assertion, method="GET", path=path)
        if active is not True:
            raise HTTPException(403 if active is False else 503, "visual_review_authority_ended")
        match = frame_target("GET", path)
        async with self.database.sessions(info={"owner_user_id": owner}) as db:
            job = await db.scalar(
                select(VisualReviewJob).where(
                    VisualReviewJob.request_id == match[2],
                    VisualReviewJob.payload_sha256 == match[3],
                    VisualReviewJob.status == "completed",
                )
            )
            if job is None or job.payload["plan"]["project_id"] != match[1]:
                raise HTTPException(404, "visual_review_frame_not_found")
            result = AgentReviewReceipt.model_validate(job.result)
            frame = next(
                (item for item in result.frames if (item.id, item.sha256) == (match[4], match[5])),
                None,
            )
            if frame is None:
                raise HTTPException(404, "visual_review_frame_not_found")
            return job.id, job.lease_id, frame

    async def settle(self, worker, lease, outcome, artifacts):
        _assertion, plan, settled = await self.leased(worker, lease, for_execution=False)
        if settled is not None:
            if settled != digest(outcome.model_dump(mode="json")):
                raise HTTPException(409, "native_receipt_conflict")
            return
        if outcome.status == "completed":
            try:
                result = AgentReviewReceipt.model_validate(outcome.result)
                validate_result(plan, result)
                if utc_now() < plan.deadline + RECOVERY_GRACE:
                    await artifacts.require(lease, result.frames)
            except (ValidationError, ValueError) as exc:
                raise HTTPException(422, "invalid_visual_review_receipt") from exc
        try:
            await self.queue.complete(
                worker_id=worker, lease=lease, outcome=outcome, allowed_operations=OPERATIONS
            )
        except NativeQueueError as exc:
            raise HTTPException(409, exc.code) from exc


def validate_result(plan, result):
    originals = {item.id for item in plan.evidence}
    frames = {item.id for item in result.frames}
    videos = {item.asset_id for item in plan.media if item.kind == "video"}
    if (
        originals & frames
        or set(result.read_ids) - (originals | frames)
        or any(frame.source_asset_id not in videos for frame in result.frames)
    ):
        raise ValueError("验收报告证据不属于任务")
    validate_report(
        result.report,
        plan.task.criteria,
        [{"id": identity} for identity in result.read_ids],
        plan.task.duration_ms,
    )

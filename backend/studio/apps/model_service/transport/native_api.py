"""Authenticated loopback Models worker protocol; public gateways never expose this lane."""

import asyncio
import secrets
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse

from app.runtime.operation_receipts import OperationError
from studio.apps.model_service.local_models.native_files import accept_result
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.contracts.model_service.model_native import OPERATIONS, ModelsObservation
from studio.runtime.files.signed_payloads import ModelOutputDescription
from studio.runtime.tasks.native_queue import NativeQueueError, digest

router = APIRouter(prefix="/_native/v1", include_in_schema=False)


class LeaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease: NativeLease


class Receipt(LeaseRequest):
    outcome: NativeOutcome


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wait_seconds: int = Field(default=1, ge=0, le=20)


class NativeModelTransport:
    def __init__(self, app, *, ingress_token, workers):
        if (
            len(ingress_token) < 32
            or not workers
            or any(len(value) < 32 for value in workers.values())
        ):
            raise ValueError("模型 worker 必须使用独立强凭据")
        self.app, self.ingress, self.workers = app, ingress_token, dict(workers)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/_native/"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        worker = next(
            (
                key
                for key, value in self.workers.items()
                if secrets.compare_digest(
                    headers.get("authorization", "").removeprefix("Bearer "), value
                )
            ),
            None,
        )
        if not worker or not secrets.compare_digest(
            headers.get("x-fpl-native-ingress", ""), self.ingress
        ):
            await JSONResponse(
                {"code": "native_worker_required"}, 403, headers={"Cache-Control": "no-store"}
            )(scope, receive, send)
            return
        scope = {**scope, "state": {**scope.get("state", {}), "native_worker": worker}}

        async def private(message):
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, private)


def broker(request):
    return request.app.state.native_models


@router.post("/report")
async def report(request: Request, body: ModelsObservation):
    await broker(request).report(request.state.native_worker, body)
    return {"acknowledged": True}


@router.post("/claim")
async def claim(request: Request, body: Claim):
    for attempt in range(body.wait_seconds * 4 + 1):
        value = await broker(request).queue.claim(
            worker_id=request.state.native_worker, allowed_operations=OPERATIONS
        )
        if value is not None:
            return {"lease": value.model_dump(mode="json")}
        if attempt < body.wait_seconds * 4:
            await asyncio.sleep(0.25)
    return {"lease": None}


@router.post("/authorize")
async def authorize(request: Request, body: LeaseRequest):
    await broker(request).authorize(request.state.native_worker, body.lease)
    return {"active": True}


@router.post("/heartbeat")
async def heartbeat(request: Request, body: LeaseRequest):
    await broker(request).lease(
        request.state.native_worker, str(body.lease.job_id), str(body.lease.lease_id)
    )
    active = await broker(request).queue.heartbeat(
        worker_id=request.state.native_worker, lease=body.lease
    )
    return {"active": active}


@router.get("/inputs/{job_id}/{lease_id}")
async def reference(request: Request, job_id: UUID, lease_id: UUID):
    path, description = await broker(request).reference(
        request.state.native_worker, str(job_id), str(lease_id)
    )
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Fpl-Content-Sha256": description["reference_sha256"],
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/outputs/{job_id}/{lease_id}")
async def output(request: Request, job_id: UUID, lease_id: UUID):
    try:
        description = ModelOutputDescription.from_header(
            request.headers.get("X-Model-Output-Descriptor", "")
        )
        if int(request.headers.get("Content-Length", "-1")) != description.byte_size:
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(422, "invalid_native_output") from None
    if request.headers.get("Content-Encoding", "identity").strip().lower() not in {"", "identity"}:
        raise HTTPException(422, "native_output_encoding_forbidden")
    return await accept_result(
        broker(request),
        request.state.native_worker,
        str(job_id),
        str(lease_id),
        description,
        request.stream(),
    )


@router.post("/receipt")
async def receipt(request: Request, body: Receipt):
    owner = broker(request)
    row, proof = await owner.lease(
        request.state.native_worker,
        str(body.lease.job_id),
        str(body.lease.lease_id),
        finalizing=True,
    )
    if (
        row.payload_sha256
        != digest({"operation": body.lease.operation, "payload": body.lease.payload})
        or row.owner_user_id != body.lease.owner_user_id
        or row.operation != body.lease.operation
    ):
        raise HTTPException(409, "native_receipt_conflict")
    if body.outcome.status == "completed":
        if proof.accepted_at is None:
            raise HTTPException(403, "native_not_started")
        if row.operation == "models.synthesize":
            if (
                row.output_descriptor is None
                or body.outcome.result.get("output") != row.output_descriptor
            ):
                raise HTTPException(409, "native_output_not_stored")
            metrics = body.outcome.result.get("metrics", {})
            if set(metrics) - {
                "ok",
                "sample_rate",
                "duration_seconds",
                "elapsed_seconds",
                "peak_memory_bytes",
                "process_peak_memory_bytes",
            }:
                raise HTTPException(422, "native_metrics_invalid")
            if any(type(value) not in {int, float, bool} for value in metrics.values()):
                raise HTTPException(422, "native_metrics_invalid")
        elif (
            set(body.outcome.result) != {"installed"}
            or type(body.outcome.result["installed"]) is not bool
        ):
            raise HTTPException(422, "native_action_result_invalid")
    try:
        await owner.queue.complete(
            worker_id=request.state.native_worker,
            lease=body.lease,
            outcome=body.outcome,
            allowed_operations=OPERATIONS,
        )
    except NativeQueueError as exc:
        raise HTTPException(409, exc.code) from None
    return {"acknowledged": True}


def attach_native(app, owner, *, ingress_token, workers):
    app.state.native_models = owner
    app.include_router(router)
    from studio.runtime.http.request_limit import RequestLimit

    app.add_middleware(
        RequestLimit,
        prefix=(
            "/_native/v1/report",
            "/_native/v1/claim",
            "/_native/v1/authorize",
            "/_native/v1/heartbeat",
            "/_native/v1/receipt",
        ),
        maximum=2 * 1024**2,
    )
    app.add_middleware(NativeModelTransport, ingress_token=ingress_token, workers=workers)

    async def operation_error(_request, exc):
        return JSONResponse(
            {"code": exc.code, "message": str(exc)},
            exc.status,
            headers={"Cache-Control": "no-store"},
        )

    app.add_exception_handler(OperationError, operation_error)

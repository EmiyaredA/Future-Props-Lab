"""Own fixed-model review attempts, quota reservations and durable provider outcomes."""

import asyncio
import base64
from time import monotonic

from sqlalchemy import select, text, update

from app.runtime.credentials import decrypt_secret
from studio.apps.model_service.admission.admission import check_capacity
from studio.apps.model_service.catalog.visual import fixed_acceptance_model
from studio.apps.model_service.providers.visual_review import (
    evaluate_review,
    fixed_connection_signature,
)
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.runtime_admission import RuntimeAdmission
from studio.apps.model_service.storage.visual_review_records import VisualReviewAttempt
from studio.contracts.agent_runtime.dialogue import ImageInput
from studio.contracts.model_service.credential_snapshot import snapshot_from_actor
from studio.contracts.visual_workshop.visual_review import ReviewModelPlan
from studio.runtime.ids import new_id
from studio.runtime.project_errors import ProjectResourceError
from studio.runtime.time import utc_now

UNKNOWN = "视觉模型验收提交结果未知，请重新发起验收"


def plan_for(pair):
    model, provider = pair
    return ReviewModelPlan(
        model_id=model.id,
        signature=fixed_connection_signature(pair),
        model_slug=model.slug,
        provider_kind=provider.kind,
    )


def received(row, fingerprint):
    if row.fingerprint != fingerprint:
        raise ProjectResourceError("模型验收请求摘要已变化", "visual_review_attempt_conflict", 409)
    return row.outcome or {"status": row.state}


def decode_images(evidence):
    result = []
    for image in evidence:
        try:
            data = base64.b64decode(image.jpeg_base64, validate=True)
        except ValueError as exc:
            raise ProjectResourceError(
                "模型验收证据不是有效 JPEG", "visual_review_invalid_image", 422
            ) from exc
        if not data.startswith(b"\xff\xd8\xff"):
            raise ProjectResourceError(
                "模型验收证据不是有效 JPEG", "visual_review_invalid_image", 422
            )
        result.append(ImageInput("image/jpeg", image.jpeg_base64, len(data)))
    return result


class VisualReviewAttempts:
    def __init__(self, state):
        self.sessions, self.settings = state.database.sessions, state.settings

    async def recover(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            owners = list(
                await session.scalars(
                    select(VisualReviewAttempt.owner_user_id)
                    .where(VisualReviewAttempt.state == "running")
                    .distinct()
                )
            )
        for owner in owners:
            async with self.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(
                    update(VisualReviewAttempt)
                    .where(VisualReviewAttempt.state == "running")
                    .values(state="unknown", outcome={"status": "unknown", "error": UNKNOWN})
                )
                await session.commit()

    async def prepare(self, actor, body):
        owner = actor.user_id
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            prior = await session.get(VisualReviewAttempt, (owner, body.run_id))
            if prior is not None:
                return received(prior, body.digest), None
            pair = await fixed_acceptance_model(session, owner, self.settings)
            if pair is None or plan_for(pair) != body.model:
                raise ProjectResourceError(
                    "固定模型连接已变化，请重新发起验收", "executor_unavailable", 409
                )
            model, provider = pair
            args = {
                "kind": provider.kind,
                "base_url": provider.base_url,
                "api_key": decrypt_secret(provider.api_key_ciphertext)
                if provider.api_key_ciphertext
                else "",
                "model": model.slug,
                "temperature": 0,
                "max_tokens": 6000,
            }
            await check_capacity(
                session, owner=owner, role=actor.platform_role, voice=False, weight=1
            )
            lease = new_id()
            session.add(
                RuntimeAdmission(
                    id=lease,
                    user_id=owner,
                    owner_user_id=owner,
                    platform_role=actor.platform_role,
                    realtime_voice=False,
                    weight=1,
                )
            )
            session.add(
                VisualReviewAttempt(
                    owner_user_id=owner,
                    run_id=body.run_id,
                    fingerprint=body.digest,
                    lease_id=lease,
                )
            )
            await session.commit()
            return None, args

    async def execute(self, actor, body, *, transport=None):
        images = decode_images(body.evidence)
        previous, args = await self.prepare(actor, body)
        if previous is not None:
            return previous
        started, usage = monotonic(), {}
        payload = {
            "criteria": body.criteria,
            "evidence": [item.evidence() for item in body.evidence],
            "coverage": body.coverage,
            "prompt": body.prompt,
        }
        try:
            parsed = await evaluate_review(args, payload, images, usage, transport)
            result = {
                "status": "completed",
                "results": parsed.model_dump(mode="json"),
                "usage": usage,
                "latency_ms": int((monotonic() - started) * 1000),
                "provider_kind": args["kind"],
                "model_slug": args["model"],
            }
        except asyncio.CancelledError:
            await asyncio.shield(
                self.finish(
                    actor, body, {"status": "unknown", "error": UNKNOWN}, usage, started, args
                )
            )
            raise
        except Exception:
            result = {"status": "failed", "error": "模型调用中断或验收响应无效"}
        return await self.finish(actor, body, result, usage, started, args)

    async def finish(self, actor, body, result, usage, started, args):
        owner = actor.user_id
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(VisualReviewAttempt, (owner, body.run_id))
            if row.state != "running":
                return received(row, body.digest)
            row.state, row.outcome = result["status"], result
            lease = await session.get(RuntimeAdmission, row.lease_id)
            if lease is not None:
                lease.released_at = utc_now()
            session.add(
                LlmCallLog(
                    owner_user_id=owner,
                    call_source="visual_acceptance",
                    trace_id=body.run_id,
                    model=args["model"],
                    provider_kind=args["kind"],
                    request_payload={"run_id": body.run_id},
                    response_payload={"results": result.get("results")},
                    status="success" if row.state == "completed" else "error",
                    error_message=result.get("error"),
                    latency_ms=int((monotonic() - started) * 1000),
                    **usage,
                    **snapshot_from_actor(actor).as_kwargs(),
                )
            )
            await session.commit()
            return result

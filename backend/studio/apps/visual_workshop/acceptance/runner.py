import asyncio
from copy import deepcopy
from time import monotonic

from sqlalchemy import select, update

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.inspection import inspect_media, verify_video
from app.runtime.credentials import decrypt_secret
from studio.apps.model_service.catalog.visual import review_models
from studio.apps.model_service.providers.visual_review import evaluate_review
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.visual_workshop.acceptance.catalog import connection_signature, fixed_model
from studio.apps.visual_workshop.acceptance.execution.agents import evaluate_agent
from studio.apps.visual_workshop.acceptance.media import (
    extract_evidence,
    flush_evidence,
    image_input,
    metadata,
)
from studio.apps.visual_workshop.acceptance.models import AcceptanceRun
from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError
from studio.apps.visual_workshop.acceptance.sample_values import check_specifications, positions
from studio.runtime.database.ownership import bind_owner
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


async def evaluate_ai(session, settings, run, transport=None):
    pair = next(
        (
            (model, provider)
            for model, provider in await review_models(session, run.owner_user_id)
            if model.id == run.model_id
        ),
        None,
    )
    if pair is None:
        raise AcceptanceError("所选视觉模型不可用，请重新选择后开始检查")
    model, provider = pair
    storage = AssetStorage(settings)
    evidence = run.evidence
    images = []
    for item in evidence:
        row = await session.get(VisualAsset, item["asset_id"])
        images.append(await image_input(storage, row))
    criteria = [item for item in run.snapshot["criteria"] if item["method"] == "ai"]
    payload = {
        "criteria": criteria,
        "evidence": evidence,
        "coverage": run.snapshot["coverage"],
        "prompt": run.snapshot.get("prompt", ""),
    }
    args = dict(
        kind=provider.kind,
        base_url=provider.base_url,
        api_key=decrypt_secret(provider.api_key_ciphertext) if provider.api_key_ciphertext else "",
        model=model.slug,
        temperature=0,
        max_tokens=6000,
    )
    started = monotonic()
    usage = {}
    identity, owner_user_id = run.id, run.owner_user_id
    error = None
    parsed = None
    try:
        await session.rollback()
        parsed = await evaluate_review(args, payload, images, usage, transport)
    except BaseException:
        error = "模型调用中断或验收响应无效"
        raise
    finally:
        session.add(
            LlmCallLog(
                owner_user_id=owner_user_id,
                call_source="visual_acceptance",
                trace_id=identity,
                model=args["model"],
                provider_kind=args["kind"],
                request_payload={"run_id": identity},
                response_payload={"results": parsed.model_dump() if parsed else None},
                status="error" if error else "success",
                error_message=error,
                latency_ms=int((monotonic() - started) * 1000),
                **usage,
            )
        )
        await asyncio.shield(session.commit())
    return parsed, usage, int((monotonic() - started) * 1000), args["kind"], args["model"]


class AcceptanceRunner(PollingTaskRunner):
    runner_name = "visual-acceptance-runner"

    def __init__(
        self,
        session_factory,
        settings,
        transport=None,
        actor_allowed=None,
        agent_executor=None,
    ):
        super().__init__()
        self.actor_allowed = actor_allowed
        self.agent_executor = agent_executor
        self.session_factory, self.settings, self.transport = (
            session_factory,
            settings,
            transport,
        )

    async def recover(self):
        async with self.session_factory() as session:
            await session.execute(
                update(AcceptanceRun)
                .where(AcceptanceRun.status.in_(["queued", "processing"]))
                .values(
                    status="failed",
                    error_message="检查被中断，请手动重新验收；系统不会自动重提模型请求。",
                    revision=AcceptanceRun.revision + 1,
                )
            )
            await session.commit()

    async def active(self, identity):
        async with self.session_factory() as session:
            row = await session.get(AcceptanceRun, identity)
            if not row or row.status != "processing":
                return False
            bind_owner(session, row.owner_user_id)
            actor = row.snapshot.get("executor", {}).get("user_id")
            if self.actor_allowed and actor:
                return await self.actor_allowed(session, row.owner_user_id, actor)
            return row.scheme_id == "legacy" or not self.actor_allowed

    async def fenced(self, identity, action):
        task = asyncio.create_task(action)
        try:
            async with asyncio.timeout(900):
                while not task.done():
                    if not await self.active(identity):
                        raise AcceptanceError("验收已取消或账号授权已失效")
                    await asyncio.wait({task}, timeout=1)
                return await task
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def process_once(self):
        async with self.session_factory() as session:
            identities = list(
                await session.scalars(
                    select(AcceptanceRun.id).where(AcceptanceRun.status == "queued").limit(4)
                )
            )
        await self.run_concurrently(identities, self.process)

    async def process(self, identity):
        try:
            async with asyncio.timeout(900):
                await self._process(identity)
        except TimeoutError:
            async with self.session_factory() as session:
                await session.execute(
                    update(AcceptanceRun)
                    .where(
                        AcceptanceRun.id == identity,
                        AcceptanceRun.status.in_(["processing", "failed"]),
                    )
                    .values(status="failed", error_message="验收超过十五分钟，请手动重试")
                )
                await session.commit()

    async def _process(self, identity):
        written = []
        additional_files = []
        committed = False
        owner_user_id = None
        try:
            async with self.session_factory() as session:
                claimed = await session.execute(
                    update(AcceptanceRun)
                    .where(AcceptanceRun.id == identity, AcceptanceRun.status == "queued")
                    .values(status="processing", revision=AcceptanceRun.revision + 1)
                )
                if claimed.rowcount != 1:
                    return
                await session.commit()
                run = await session.get(AcceptanceRun, identity)
                owner_user_id = run.owner_user_id
                bind_owner(session, owner_user_id)
                session.autoflush = False
                snapshot = deepcopy(run.snapshot)
                if not await self.active(identity):
                    raise AcceptanceError("执行账号已无验收权限")
                if run.scheme_id == "motion-transfer:api":
                    pair = await fixed_model(session, owner_user_id, self.settings)
                    if (
                        pair is None
                        or pair[0].id != run.model_id
                        or connection_signature(run.scheme_id, self.settings, pair)
                        != snapshot.get("executor", {}).get("connection_signature")
                    ):
                        raise AcceptanceError("固定模型连接已变化，请手动重新发起验收")
                info = await metadata(session, self.settings, run)
                output = snapshot["output"]
                if output["kind"] == "video":
                    source = await session.get(VisualAsset, output["asset_id"])
                    await verify_video(AssetStorage(self.settings).path_for(source))
                snapshot["metadata"] = info
                run.snapshot = snapshot
                evidence = []
                if any(item["method"] == "ai" for item in snapshot["criteria"]):
                    if output["kind"] == "video":
                        evidence, files = await extract_evidence(
                            session,
                            self.settings,
                            run,
                            output["asset_id"],
                            positions(info["duration_ms"]),
                        )
                        written.extend(files)
                    elif output["asset_id"]:
                        evidence = [
                            {
                                "id": "output",
                                "asset_id": output["asset_id"],
                                "source_asset_id": output["asset_id"],
                                "position_ms": None,
                            }
                        ]
                    refs = {
                        ref for item in snapshot["criteria"] for ref in item["reference_asset_ids"]
                    }
                    for ref in sorted(refs):
                        source = await session.get(VisualAsset, ref)
                        if source.media_kind == "image":
                            evidence.append(
                                {
                                    "id": "ref-" + ref,
                                    "asset_id": ref,
                                    "source_asset_id": ref,
                                    "position_ms": None,
                                }
                            )
                        elif source.media_kind == "video":
                            data = await inspect_media(
                                AssetStorage(self.settings).path_for(source), "video"
                            )
                            samples, files = await extract_evidence(
                                session,
                                self.settings,
                                run,
                                ref,
                                [0, max(0, data["duration_ms"] // 2)],
                            )
                            evidence.extend(samples)
                            written.extend(files)
                run.evidence = evidence
                results = []
                for item in snapshot["criteria"]:
                    verdict, explanation = (
                        check_specifications(info, item["specifications"])
                        if item["method"] == "automatic"
                        else (
                            "pending",
                            "等待人工确认" if item["method"] == "manual" else "等待 AI 建议",
                        )
                    )
                    results.append(
                        {
                            "criterion_id": item["id"],
                            "verdict": verdict,
                            "origin": item["method"],
                            "explanation": explanation,
                            "evidence_ids": [],
                        }
                    )
                run.results = results
                run.snapshot = {**snapshot, "check_results": deepcopy(results)}
                await flush_evidence(session)
                await session.commit()
                committed = True
                await session.refresh(run)
                if run.status != "processing":
                    return
                # Evidence is committed before network work; no database writer is
                # held across decoding or model I/O.
                execution_result = {}
                additional = []
                if (
                    run.scheme_id.startswith("motion-transfer:")
                    and run.scheme_id != "motion-transfer:api"
                ):

                    async def cancelled():
                        return not await self.active(identity)

                    kwargs = {"executor": self.agent_executor} if self.agent_executor else {}
                    report, additional, files = await evaluate_agent(
                        session, self.settings, run, cancelled, **kwargs
                    )
                    additional_files = files
                    execution_result = {
                        "kind": "code_agent",
                        "report": report.model_dump(mode="json"),
                    }
                    suggestions = {item.criterion_id: item for item in report.findings}
                    for result in results:
                        if result["criterion_id"] in suggestions:
                            suggestion = suggestions[result["criterion_id"]]
                            result.update(
                                suggestion=suggestion.suggestion,
                                explanation=suggestion.explanation,
                                evidence_ids=suggestion.evidence_ids,
                                start_ms=suggestion.start_ms,
                                end_ms=suggestion.end_ms,
                            )
                elif any(item["method"] == "ai" for item in snapshot["criteria"]):
                    parsed, usage, latency, provider_kind, model_slug = await self.fenced(
                        identity, evaluate_ai(session, self.settings, run, self.transport)
                    )
                    execution_result = {
                        "kind": "model_api",
                        "results": parsed.model_dump(mode="json"),
                        "usage": usage,
                        "latency_ms": latency,
                        "provider_kind": provider_kind,
                        "model_slug": model_slug,
                    }
                    suggestions = {item.criterion_id: item for item in parsed.results}
                    for result in results:
                        if result["criterion_id"] in suggestions:
                            suggestion = suggestions[result["criterion_id"]]
                            result.update(
                                suggestion=suggestion.verdict,
                                explanation=suggestion.explanation,
                                evidence_ids=suggestion.evidence_ids,
                            )
                # An independently cancelled run must never receive late results or evidence.
                updated = await session.execute(
                    update(AcceptanceRun)
                    .where(AcceptanceRun.id == identity, AcceptanceRun.status == "processing")
                    .values(
                        results=results,
                        snapshot={**snapshot, "check_results": deepcopy(results)},
                        evidence=[*evidence, *additional],
                        execution_result=execution_result,
                        status="completed",
                        revision=AcceptanceRun.revision + 1,
                        updated_at=utc_now(),
                    )
                )
                if not updated.rowcount:
                    await session.rollback()
                    for path in additional_files:
                        path.unlink(missing_ok=True)
                    return
                await session.commit()
                additional_files = []
        except (Exception, asyncio.CancelledError) as exc:
            for path in additional_files:
                path.unlink(missing_ok=True)
            if not committed:
                for path in written:
                    path.unlink(missing_ok=True)
            async with self.session_factory() as session:
                # Some evidence may already be durably referenced; do not unlink it.
                await session.execute(
                    update(AcceptanceRun)
                    .where(AcceptanceRun.id == identity, AcceptanceRun.status == "processing")
                    .values(
                        status="failed",
                        error_message="检查失败："
                        + (
                            str(exc)[:300]
                            if isinstance(exc, (ValueError, AcceptanceError))
                            else "媒体读取或模型调用异常，请查看日志并手动重试。"
                        ),
                        revision=AcceptanceRun.revision + 1,
                    )
                )
                await session.commit()
            if isinstance(exc, asyncio.CancelledError):
                raise

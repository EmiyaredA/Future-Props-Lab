"""Resume Visual review evidence and obtain one fixed-model receipt."""

import asyncio
from copy import deepcopy
from datetime import timedelta

import httpx
from sqlalchemy import select, text

from studio.apps.visual_workshop.acceptance.models import AcceptanceRun
from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError
from studio.apps.visual_workshop.acceptance.runs import run_out
from studio.apps.visual_workshop.review.review_agent import ReviewAgent
from studio.apps.visual_workshop.review.review_baseline import ReviewBaseline, ReviewChanged
from studio.apps.visual_workshop.review.review_model import ReviewModel
from studio.apps.visual_workshop.storage.review_dispatch_records import VisualReviewDispatch
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.project_errors import ProjectResourceError
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


class ReviewRunner(PollingTaskRunner):
    runner_name = "visual-node-reviews"
    poll_interval_seconds = 1

    def __init__(self, state):
        super().__init__()
        self.state = state
        self.sessions = state.database.sessions
        self.identity = state.snapshot_authorization

    async def recover(self):
        # The owned source ledger and Models outcome determine how far each run went.
        return

    async def process_once(self):
        dispatch = VisualReviewDispatch
        async with self.sessions(info={"allow_system_reads": True}) as db:
            jobs = list(
                (
                    await db.execute(
                        select(dispatch.owner_user_id, dispatch.run_id)
                        .order_by(dispatch.checked_at, dispatch.run_id)
                        .limit(4)
                    )
                ).tuples()
            )
        failures = await asyncio.gather(
            *(self.run(owner, run) for owner, run in jobs), return_exceptions=True
        )
        for failure in failures:
            if isinstance(failure, BaseException):
                raise failure

    async def run(self, owner, identity):
        try:
            async with asyncio.timeout(900):
                await self.execute(owner, identity)
        except TimeoutError:
            await self.finish(owner, identity, error="验收超过十五分钟，请手动重试")
        except ReviewChanged:
            return
        except (CapabilityUnavailable, httpx.TransportError) as exc:
            raise CapabilityUnavailable("视觉验收等待服务恢复") from exc
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code >= 500:
                raise CapabilityUnavailable("视觉验收等待服务恢复") from exc
            await self.finish(
                owner, identity, error="媒体读取或模型调用异常，请查看日志并手动重试。"
            )
        except (CapabilityDenied, ProjectResourceError, AcceptanceError) as exc:
            if exc.status in (429, 503):
                raise CapabilityUnavailable("视觉验收等待服务恢复") from exc
            error = "执行账号已无验收权限" if exc.status in (401, 403) else str(exc)
            await self.finish(owner, identity, error=error)
        except (KeyError, ValueError, OSError) as exc:
            await self.finish(owner, identity, error=str(exc)[:300])

    async def execute(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            dispatch = await db.get(VisualReviewDispatch, identity)
            run = await db.get(AcceptanceRun, identity)
            if dispatch is None or run is None:
                return
            if run.status not in ("queued", "processing"):
                await db.delete(dispatch)
                await db.commit()
                return
            deadline = run.created_at + timedelta(minutes=15)
            if deadline < utc_now():
                await db.rollback()
                await self.finish(owner, identity, error="验收超过十五分钟，请手动重试")
                return
            dispatch.checked_at = utc_now()
            if run.status == "queued":
                run.status = "processing"
                run.revision += 1
            await db.commit()
            project_id, current = run.project_id, run_out(run)
            executor = dispatch.executor
            assertion, source = dispatch.assertion, dispatch.source_path

            async def verify():
                await self.require_processing(owner, identity, assertion, source)

            await self.state.reference_delivery.deliver(owner, dispatch.retention_receipt)
            await verify()
            baseline = ReviewBaseline(self.state, db, dispatch, project_id)
            current = await baseline.prepare(current)

            async def evaluate():
                if executor["kind"] == "code_agent":
                    agent = ReviewAgent(self.state.capabilities, assertion, source)
                    return await agent.execute(db, baseline, current, executor, deadline)
                images = []
                for evidence in current.evidence:
                    images.append(
                        await baseline.media.model_image(
                            project_id, identity, evidence.model_dump()
                        )
                    )
                model = ReviewModel(self.state.capabilities, assertion, source)
                return await model.execute(project_id, current, executor["model"], images)

            outcome = await fenced(evaluate, verify)
        if outcome["status"] == "running":
            return
        await verify()
        if outcome["status"] == "completed":
            await self.finish(owner, identity, outcome=outcome)
        else:
            await self.finish(owner, identity, error=outcome["error"])

    async def require_processing(self, owner, identity, assertion, source):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            run = await db.get(AcceptanceRun, identity)
            if run is None or run.status != "processing":
                raise ReviewChanged
        active = await self.identity.status(assertion=assertion, method="POST", path=source)
        if active is None:
            raise CapabilityUnavailable("验收账号授权暂不可确认")
        if active is False:
            raise CapabilityDenied(403)

    async def finish(self, owner, identity, *, outcome=None, error=None):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            dispatch = await db.get(VisualReviewDispatch, identity)
            row = await db.get(AcceptanceRun, identity)
            if dispatch is None or row is None:
                return
            if row.status in ("queued", "processing"):
                if outcome is None:
                    row.status = "failed"
                    row.error_message = f"检查失败：{error}"[:350]
                else:
                    apply_outcome(row, outcome)
                row.revision += 1
            await db.delete(dispatch)
            await db.commit()


async def fenced(evaluate, verify):
    task = asyncio.create_task(evaluate())
    try:
        while not task.done():
            await verify()
            await asyncio.wait({task}, timeout=1)
        return await task
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


def apply_outcome(row, outcome):
    if outcome.get("kind") == "code_agent":
        apply_agent_outcome(row, outcome["report"])
        return
    suggestions = {item["criterion_id"]: item for item in outcome["results"]["results"]}
    results = deepcopy(row.results)
    for result in results:
        suggestion = suggestions.get(result["criterion_id"])
        if suggestion is not None:
            result.update(
                suggestion=suggestion["verdict"],
                explanation=suggestion["explanation"],
                evidence_ids=suggestion["evidence_ids"],
            )
    row.results = results
    row.snapshot = {**row.snapshot, "check_results": deepcopy(results)}
    row.execution_result = {
        "kind": "model_api",
        **{
            key: outcome[key]
            for key in ("results", "usage", "latency_ms", "provider_kind", "model_slug")
        },
    }
    row.status = "completed"


def apply_agent_outcome(row, report):
    findings = {item["criterion_id"]: item for item in report["findings"]}
    results = deepcopy(row.results)
    for result in results:
        finding = findings.get(result["criterion_id"])
        if finding is not None:
            result.update(
                {
                    key: finding[key]
                    for key in ("suggestion", "explanation", "evidence_ids", "start_ms", "end_ms")
                }
            )
    row.results = results
    row.snapshot = {**row.snapshot, "check_results": deepcopy(results)}
    row.execution_result = {"kind": "code_agent", "report": report}
    row.status = "completed"

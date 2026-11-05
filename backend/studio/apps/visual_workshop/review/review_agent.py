"""Dispatch a frozen Visual evidence package to the Mac Agent Runtime owner."""

from contextlib import asynccontextmanager

import httpx
from pydantic import TypeAdapter

from studio.apps.visual_workshop.acceptance.models import AcceptanceRun
from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError
from studio.apps.visual_workshop.review.review_baseline import ReviewChanged
from studio.apps.visual_workshop.review.review_media import check
from studio.apps.visual_workshop.storage.review_dispatch_records import VisualReviewDispatch
from studio.contracts.asset_library.descriptions import LibraryAssetDescription
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.visual_workshop.visual_agent_review import (
    ASSET_PURPOSE,
    JOB_PURPOSE,
    RESULT_PURPOSE,
    AgentReviewPlan,
    AgentReviewReceipt,
    ReviewAssetQuery,
)
from studio.runtime.http.capability_client import CapabilityDenied

ASSET_DESCRIPTIONS = TypeAdapter(list[LibraryAssetDescription])


class ReviewAgent:
    def __init__(self, peer, assertion, source):
        self.peer, self.assertion, self.source = peer, assertion, source

    async def authorize(self, purpose, service, method, path):
        return await self.peer.authorize_request(
            self.assertion,
            RequestGrant("visual", purpose, "POST", self.source, service, method, path),
        )

    async def post(self, purpose, service, path, body):
        token = await self.authorize(purpose, service, "POST", path)
        result = await self.peer.client.post(
            f"http://{service}:8080" + path, headers={HEADER: token}, json=body
        )
        if result.status_code in (401, 403):
            raise CapabilityDenied(result.status_code)
        if result.status_code == 409:
            raise AcceptanceError("Mac 验收计划已变化", "visual_agent_plan_changed", 409)
        result.raise_for_status()
        return result

    async def freeze(self, db, baseline, run, executor, deadline):
        if executor.get("agent_plan") is not None:
            return AgentReviewPlan.model_validate(executor["agent_plan"])
        project_id = baseline.project_id
        media = [
            {"asset_id": item["asset_id"], "label": item["label"], "kind": item["kind"]}
            for item in run.snapshot.inputs["assets"]
        ]
        evidence = [item.model_dump(mode="json") for item in run.evidence]
        query = ReviewAssetQuery(
            asset_ids=sorted({item["asset_id"] for item in (*media, *evidence)})
        )
        result = await self.post(
            ASSET_PURPOSE, "assets", query.path(project_id, run.id), query.model_dump()
        )
        files = ASSET_DESCRIPTIONS.validate_json(result.content)
        if [item.id for item in files] != query.asset_ids:
            raise ValueError("Mac 验收素材清单与冻结引用不符")
        plan = AgentReviewPlan(
            project_id=project_id,
            run_id=run.id,
            agent=executor["agent"],
            connection_signature=executor["projection"]["connection_signature"],
            deadline=deadline,
            task={
                **run.snapshot.model_dump(include={"criteria", "prompt", "coverage", "output"}),
                "duration_ms": run.snapshot.metadata["duration_ms"],
            },
            media=media,
            evidence=evidence,
            files=files,
        )
        await baseline.locked_run(run.revision)
        dispatch = await db.get(VisualReviewDispatch, run.id, populate_existing=True)
        if dispatch is None:
            raise ReviewChanged
        dispatch.executor = {**executor, "agent_plan": plan.model_dump(mode="json")}
        await db.commit()
        return plan

    async def execute(self, db, baseline, run, executor, deadline):
        plan = await self.freeze(db, baseline, run, executor, deadline)
        result = await self.post(
            JOB_PURPOSE, "agent-runtime", plan.path, plan.model_dump(mode="json")
        )
        outcome = result.json()
        if outcome["status"] in ("queued", "leased"):
            return {"status": "running"}
        if outcome["status"] != "completed":
            return {
                "status": outcome["status"],
                "error": "Mac 验收执行中断，请重新发起验收"
                if outcome["status"] == "unknown"
                else "Mac 验收授权或固定连接已失效",
            }
        receipt = AgentReviewReceipt.model_validate(outcome["result"])
        saved = {item.id for item in run.evidence}
        for frame in receipt.frames:
            if frame.id in saved:
                continue
            async with self.frame(plan, frame) as response:
                run = await baseline.publish_frames(
                    run, frame.source_asset_id, response, native_frame=frame
                )
        return {
            "status": "completed",
            "kind": "code_agent",
            "report": receipt.report.model_dump(mode="json"),
        }

    @asynccontextmanager
    async def frame(self, plan, frame):
        path = plan.frame_path(frame)
        token = await self.authorize(RESULT_PURPOSE, "agent-runtime", "GET", path)
        async with self.peer.client.stream(
            "GET",
            "http://agent-runtime:8080" + path,
            headers={HEADER: token, "Accept-Encoding": "identity"},
            timeout=httpx.Timeout(60, connect=5),
        ) as result:
            if result.status_code != 200:
                await result.aread()
                check(result)
            yield result


async def active_review(database, owner, project_id, run_id, digest):
    async with database.sessions(info={"owner_user_id": owner}) as db:
        run = await db.get(AcceptanceRun, run_id)
        dispatch = await db.get(VisualReviewDispatch, run_id)
        plan = dispatch.executor.get("agent_plan") if dispatch is not None else None
        return bool(
            run is not None
            and run.project_id == project_id
            and run.status == "processing"
            and plan is not None
            and AgentReviewPlan.model_validate(plan).digest == digest
        )

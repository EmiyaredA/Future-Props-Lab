"""Dispatch fixed visual model reviews with a digest-bound request."""

import httpx

from studio.apps.visual_workshop.acceptance.acceptance_options import (
    agent_scheme,
    agents,
    selected_scheme,
)
from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.visual_workshop.visual_review import (
    MODEL_PLAN,
    PLAN_PURPOSE,
    RUN_PURPOSE,
    ReviewModelPlan,
    ReviewModelRun,
)
from studio.runtime.http.capability_client import CapabilityDenied


class ReviewModel:
    def __init__(self, peer, assertion, source):
        self.peer, self.assertion, self.source = peer, assertion, source

    async def send(self, method, path, purpose, **kwargs):
        token = await self.peer.authorize_request(
            self.assertion,
            RequestGrant("visual", purpose, "POST", self.source, "models", method, path),
        )
        response = await self.peer.client.request(
            method, "http://models:8080" + path, headers={HEADER: token}, **kwargs
        )
        if response.status_code in (401, 403):
            raise CapabilityDenied(response.status_code)
        if response.status_code == 409:
            detail = response.json().get("detail", {})
            raise AcceptanceError(
                detail.get("message", "固定视觉模型已变化，请重新发起验收"),
                detail.get("code", "executor_unavailable"),
                409,
            )
        if response.status_code == 429:
            return {"status": "running"}
        response.raise_for_status()
        return response.json()

    async def execute(self, project_id, run, plan, images):
        body = ReviewModelRun(
            project_id=project_id,
            run_id=run.id,
            model=plan,
            evidence=images,
            criteria=[
                item.model_dump(mode="json")
                for item in run.snapshot.criteria
                if item.method == "ai"
            ],
            coverage=run.snapshot.coverage,
            prompt=run.snapshot.prompt,
        )
        return await self.send(
            "POST",
            body.path,
            RUN_PURPOSE,
            json=body.model_dump(mode="json"),
            timeout=httpx.Timeout(900, connect=5),
        )


async def plan_executor(request, scheme):
    if scheme != "motion-transfer:api":
        return await plan_native_agent(request, scheme)
    status = await selected_scheme(request, scheme, probe=True)
    if not status.available:
        raise AcceptanceError(status.message, "executor_unavailable", 409)
    model = ReviewModel(
        request.app.state.capabilities, request.state.service_assertion, request.url.path
    )
    value = await model.send("GET", MODEL_PLAN, PLAN_PURPOSE)
    if value is None:
        raise AcceptanceError("固定模型已不可用", "executor_unavailable", 409)
    plan = ReviewModelPlan.model_validate(value)
    return {
        "kind": "model_api",
        "model": plan.model_dump(mode="json"),
        "projection": {
            "connection_label": status.connection_label,
            "model_id": plan.model_id,
            "connection_signature": plan.signature,
        },
    }


async def plan_native_agent(request, scheme):
    catalog = await agents(request, probe=True)
    status = agent_scheme(scheme, catalog)
    agent = scheme.removeprefix("motion-transfer:")
    selected = catalog.get(agent)
    if not status.available or selected is None or selected.signature is None:
        raise AcceptanceError(status.message, "executor_unavailable", 409)
    return {
        "kind": "code_agent",
        "agent": agent,
        "projection": {
            "connection_label": status.connection_label,
            "model_id": None,
            "connection_signature": selected.signature,
        },
    }

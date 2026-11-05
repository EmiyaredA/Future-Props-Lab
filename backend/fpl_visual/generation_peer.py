"""Use exact Identity grants for preparation and signed source decisions for settlement."""

from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field

from app.apps.visual_workshop.generation_common import GenerationError
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.visual_generation import (
    ASSET_PURPOSE,
    MODEL_PURPOSE,
    ORIGINALS_HEADER,
    PLAN_PURPOSE,
    PLANS,
    GenerationAssetQuery,
    GenerationAssets,
    ModelSelection,
    VisualModelChoice,
)
from fpl_runtime.visual_generation_approval import ADMIT, GenerationApproval


class PreparedPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    plan_id: str
    state: str
    payloads: dict[str, dict]


class ProviderOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    filename: str
    mime_type: str
    byte_size: int = Field(ge=1, strict=True)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class ProviderStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    task_id: str
    status: Literal[
        "queued", "submitting", "pending", "processing", "completed", "failed", "cancelled"
    ]
    provider_task_id: str | None
    progress: int
    execution_info: dict | None
    error_message: str | None
    revision: int
    can_retry_materialization: bool
    result: ProviderOutput | None


def check(reply):
    if reply.status_code in {401, 403, 404, 409, 413, 422, 429}:
        body = reply.json()
        raise GenerationError(
            body.get("title") or "生成任务请求失败",
            code=body.get("code") or "visual_generation_failed",
            status=reply.status_code,
        )
    reply.raise_for_status()


class GenerationPeer:
    def __init__(self, state, *, assertion=None, source=None):
        self.client = state.capabilities
        self.sign = state.visual_generation_peer
        self.assertion, self.source = assertion, source

    async def token(self, purpose, service, path):
        try:
            return await self.client.authorize_request(
                self.assertion,
                RequestGrant("visual", purpose, "POST", self.source, service, "POST", path),
            )
        except CapabilityDenied as exc:
            raise GenerationError(
                "生成任务授权已结束", code="visual_generation_authority_ended", status=exc.status
            ) from exc

    async def request(self, service, path, purpose, data, headers=None, timeout=30):
        try:
            token = await self.token(purpose, service, path)
            response = await self.client.client.post(
                f"http://{service}:8080" + path,
                headers={**(headers or {}), HEADER: token},
                json=data,
                timeout=timeout,
            )
            check(response)
            return response.content
        except (CapabilityUnavailable, httpx.HTTPError, TypeError, ValueError) as exc:
            raise GenerationError(
                "生成服务暂不可用", code="visual_generation_unavailable", status=503
            ) from exc

    async def model(self, body):
        query = ModelSelection(
            model_id=body.model_id,
            kind=body.kind,
            audio_mode=body.mode if body.kind == "audio" else None,
        )
        raw = await self.request("models", query.path, MODEL_PURPOSE, query.model_dump(mode="json"))
        choice = VisualModelChoice.model_validate_json(raw)
        if choice.model_id != body.model_id:
            raise GenerationError(
                "模型选择回执不一致", code="visual_generation_unavailable", status=503
            )
        return choice

    async def assets(self, project, identity, references):
        if not references:
            return GenerationAssets(items=[], max_video_bytes=1)
        query = GenerationAssetQuery(asset_ids=sorted(references))
        raw = await self.request(
            "assets", query.path(project, identity), ASSET_PURPOSE, query.model_dump(mode="json")
        )
        return GenerationAssets.model_validate_json(raw)

    async def admit(self, owner, plan):
        (task,) = plan.tasks
        body = GenerationApproval(
            owner_id=owner,
            project_id=plan.project_id,
            task_id=task.task_id,
            plan_sha256=plan.digest,
            source_path=self.source,
            kind=task.arguments.kind,
        )
        try:
            response = await self.client.client.post(
                self.client.identity_url + ADMIT,
                headers={
                    HEADER: self.assertion,
                    "Authorization": "Bearer " + self.client.credential,
                },
                json=body.model_dump(mode="json"),
            )
            check(response)
            if response.json() != {"task_id": str(body.task_id), "plan_sha256": plan.digest}:
                raise ValueError("generation approval receipt mismatch")
        except (httpx.HTTPError, TypeError, ValueError) as exc:
            raise GenerationError(
                "生成审批回执未确认", code="visual_generation_unavailable", status=503
            ) from exc

    async def prepare(self, plan):
        headers = {}
        if plan.scope is not None:
            path = plan.scope.path(plan.project_id, str(plan.plan_id))
            headers[ORIGINALS_HEADER] = await self.token(ASSET_PURPOSE, "assets", path)
        raw = await self.request(
            "models", plan.path, PLAN_PURPOSE, plan.model_dump(mode="json"), headers, timeout=320
        )
        receipt = PreparedPlan.model_validate_json(raw)
        if (
            receipt.plan_id != str(plan.plan_id)
            or receipt.state != "prepared"
            or set(receipt.payloads) != {str(task.task_id) for task in plan.tasks}
        ):
            raise GenerationError(
                "生成批次回执不一致", code="visual_generation_unavailable", status=503
            )
        return receipt.payloads

    @staticmethod
    def path(decision):
        return f"{PLANS}/{decision.project_id}/{decision.id}/{decision.plan_sha256}"

    async def signed(self, method, path, owner):
        try:
            response = await self.client.client.request(
                method, "http://models:8080" + path, headers=self.sign.headers(method, path, owner)
            )
            check(response)
            return response
        except (httpx.HTTPError, TypeError, ValueError) as exc:
            raise CapabilityUnavailable("模型生成回执暂不可用") from exc

    async def settle(self, decision):
        result = await self.signed(
            "POST", self.path(decision) + "/" + decision.state, decision.owner_user_id
        )
        if result.json().get("state") != ("active" if decision.state == "activate" else "aborted"):
            raise CapabilityUnavailable("模型生成决议未确认")

    async def status(self, decision, task_id, suffix=""):
        path = self.path(decision) + "/tasks/" + task_id + suffix
        response = await self.signed("POST" if suffix else "GET", path, decision.owner_user_id)
        result = ProviderStatus.model_validate_json(response.content)
        if result.task_id != task_id:
            raise CapabilityUnavailable("模型生成结果身份不匹配")
        return result

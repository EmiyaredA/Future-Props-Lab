"""Keep the Visual harness local while Models runs its exact provider rounds."""

import httpx

from app.capabilities.agents.harness.contracts import ModelTextDelta, ModelTurnEnd, ModelUsageUpdate
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.visual_assistant import MODEL_RUN_PURPOSE
from fpl_runtime.visual_assistant_model import (
    MODEL_EVENTS,
    AssistantModelPlan,
    AssistantRound,
    ErrorEvent,
    TextEvent,
    TurnEvent,
)


class AssistantModelClient:
    def __init__(self, peer, assertion, source, scope):
        self.peer, self.assertion, self.source = peer, assertion, source
        self.scope = scope.model_dump()
        self.plan = None

    async def authorize(self, path):
        return await self.peer.authorize_request(
            self.assertion,
            RequestGrant("visual", MODEL_RUN_PURPOSE, "POST", self.source, "models", "POST", path),
        )

    async def control(self, body):
        try:
            token = await self.authorize(body.path)
            response = await self.peer.client.post(
                "http://models:8080" + body.path,
                headers={HEADER: token},
                json=body.model_dump(mode="json"),
            )
            return check(response).json()
        except CapabilityDenied as exc:
            raise ProjectResourceError(
                "模型使用授权已撤销", "assistant_model_denied", exc.status
            ) from exc
        except (httpx.HTTPError, CapabilityUnavailable, ValueError) as exc:
            raise ProjectResourceError(
                "对话模型暂不可用", "assistant_model_unavailable", 503
            ) from exc

    async def begin(self, body):
        self.plan = AssistantModelPlan.model_validate(await self.control(body))
        return self.plan

    async def settle(self, body):
        return await self.control(body)

    async def stream_turn(
        self, *, system, messages, tools, model, temperature, max_tokens, round_index
    ):
        if self.plan is None or model != self.plan.model_slug:
            raise CapabilityUnavailable("模型轮次与已确认的对话模型不符")
        body = AssistantRound(
            **self.scope,
            index=round_index,
            system=system,
            messages=messages,
            tools=tools,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        token = await self.authorize(body.path)
        async with self.peer.client.stream(
            "POST",
            "http://models:8080" + body.path,
            headers={HEADER: token},
            json=body.model_dump(mode="json"),
            timeout=httpx.Timeout(150, connect=5),
        ) as response:
            if response.status_code != 200:
                await response.aread()
                check(response)
            if response.headers.get("Content-Type") != "application/x-ndjson":
                raise CapabilityUnavailable("模型轮次响应类型无效")
            async for line in response.aiter_lines():
                event = MODEL_EVENTS.validate_json(line)
                if isinstance(event, TextEvent):
                    yield ModelTextDelta(event.text)
                elif isinstance(event, TurnEvent):
                    yield ModelTurnEnd(event.tool_calls, event.usage)
                    return
                elif isinstance(event, ErrorEvent):
                    raise CapabilityUnavailable(event.error)
                else:
                    yield ModelUsageUpdate(event.usage)
        raise CapabilityUnavailable("模型轮次响应未完成")


def check(response):
    if response.status_code in {401, 403, 404, 409, 413, 422, 429}:
        data = response.json()
        raise ProjectResourceError(
            data.get("title") or "模型请求被拒绝",
            data.get("code") or "assistant_model_denied",
            response.status_code,
        )
    response.raise_for_status()
    return response

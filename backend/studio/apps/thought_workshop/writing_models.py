"""Writing uses purpose-bound Models HTTP; Thought never receives provider credentials."""

import asyncio
import json
from dataclasses import asdict

import httpx
from pydantic import TypeAdapter

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.schemas.workshop import ThoughtModelOut
from studio.apps.thought_workshop.writing import WritingModel
from studio.contracts.identity.delegation import RequestGrant, permitted
from studio.contracts.thought_workshop.writing import WRITING_MODELS_PATH, WritingInput, event
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable

MODELS = TypeAdapter(list[ThoughtModelOut])


class HttpWritingModels:
    def __init__(
        self,
        *,
        assertion,
        source_method,
        source_path,
        credential,
        catalog,
        identity_url="http://identity:8080",
        models_url="http://models:8080",
        transport=None,
    ):
        self.assertion, self.method, self.path = assertion, source_method, source_path
        self.credential, self.catalog = credential, catalog
        self.identity_url, self.models_url, self.transport = identity_url, models_url, transport

    def client(self):
        return httpx.AsyncClient(
            trust_env=False,
            follow_redirects=False,
            timeout=httpx.Timeout(30, read=60),
            transport=self.transport,
        )

    async def authorize(self, client, method, path):
        purpose = "thought.writing.list" if method == "GET" else "thought.writing.complete"
        grant = RequestGrant("thought", purpose, self.method, self.path, "models", method, path)
        if not permitted(grant, self.catalog):
            raise CapabilityDenied(403)
        try:
            response = await client.post(
                self.identity_url + "/_internal/v1/authorization/delegate",
                headers={"Authorization": "Bearer " + self.credential},
                json={**asdict(grant), "assertion": self.assertion},
            )
            if response.status_code in {401, 403}:
                raise CapabilityDenied(response.status_code)
            if response.status_code != 200:
                raise CapabilityUnavailable("写作授权暂不可用")
            token = response.json()["assertion"]
            if not isinstance(token, str) or not 1 <= len(token) <= 8192:
                raise ValueError("invalid assertion")
            return token
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise CapabilityUnavailable("写作授权未确认") from exc

    async def list(self):
        try:
            async with self.client() as client:
                token = await self.authorize(client, "GET", WRITING_MODELS_PATH)
                response = await client.get(
                    self.models_url + WRITING_MODELS_PATH,
                    headers={"X-Fpl-Context": token},
                )
                if response.status_code in {401, 403}:
                    raise CapabilityDenied(response.status_code)
                if response.status_code != 200 or len(response.content) > 1024 * 1024:
                    raise CapabilityUnavailable("写作模型列表暂不可用")
                return MODELS.validate_json(response.content)
        except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError):
            raise ThoughtError(
                "写作模型暂不可用或授权已失效", 503, "writing_models_unavailable"
            ) from None

    async def select(self, model_id):
        selected = next((model for model in await self.list() if model.id == model_id), None)
        if selected is None:
            raise ThoughtError("模型不存在或暂不可用", 404, "not_found")
        return WritingModel(selected.id, selected.label, selected.id)

    async def events(self, prepared):
        if prepared.model.handle != prepared.model.id:
            raise ValueError("写作模型未绑定Models服务")
        body = WritingInput(
            model_id=prepared.model.id,
            note_id=prepared.note_id,
            revision=prepared.revision,
            action=prepared.action,
            instruction=prepared.instruction,
            content=prepared.content,
        )
        terminal = False
        try:
            async with self.client() as client:
                token = await self.authorize(client, "POST", body.path)
                async with client.stream(
                    "POST",
                    self.models_url + body.path,
                    headers={"X-Fpl-Context": token},
                    json=body.model_dump(mode="json"),
                ) as response:
                    if response.status_code != 200:
                        raise CapabilityUnavailable("写作请求未被接受")
                    data = []
                    size = 0
                    async for line in response.aiter_lines():
                        size += len(line)
                        if size > 1024 * 1024:
                            raise CapabilityUnavailable("写作事件超过传输上限")
                        if line.startswith("data:"):
                            data.append(line[5:].lstrip())
                        elif not line and data:
                            message = json.loads("\n".join(data))
                            data, size = [], 0
                            if not isinstance(message, dict):
                                raise ValueError("invalid event")
                            kind = message.get("type")
                            if kind == "delta" and isinstance(message.get("text"), str):
                                yield event("delta", text=message["text"])
                            elif kind == "complete":
                                terminal = True
                                yield event("complete")
                                return
                            elif kind == "error":
                                terminal = True
                                yield event("error", message="模型请求失败，请检查模型配置后重试")
                                return
                            else:
                                raise ValueError("invalid event")
                    if not terminal:
                        raise CapabilityUnavailable("写作事件流未完成")
        except (asyncio.CancelledError, GeneratorExit):
            raise
        except (CapabilityDenied, CapabilityUnavailable, httpx.HTTPError, ValueError, TypeError):
            yield event("error", message="模型请求失败，请检查模型配置后重试")

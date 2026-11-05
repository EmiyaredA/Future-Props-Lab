"""Per-application deterministic demo execution, independent of configuration storage."""

import asyncio
import json
from collections import deque
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import httpx

MOCK_BASE_URL = "https://fpl-mock.invalid/v1"
TOOL_BASE_URL = "https://fpl-tools.invalid"
SERVICE_IDS = ("mock_model", "example_tools")
DEFAULT_CONFIG = {
    "enabled": False,
    "delay_ms": 0,
    "failure": False,
    "response_text": "这是本地测试模型的确定性回复。",
}


def completion_sse(payload):
    choice = payload["choices"][0]
    message = choice["message"]
    delta = {key: value for key, value in message.items() if value is not None}
    if "tool_calls" in delta:
        delta["tool_calls"] = [
            dict(item, index=index) for index, item in enumerate(delta["tool_calls"])
        ]
    chunk = {key: payload[key] for key in ("id", "model", "created")}
    chunk.update(
        object="chat.completion.chunk",
        choices=[{"index": 0, "delta": delta, "finish_reason": None}],
    )
    end = {
        **chunk,
        "choices": [{"index": 0, "delta": {}, "finish_reason": choice["finish_reason"]}],
        "usage": payload["usage"],
    }
    return (
        "".join("data: " + json.dumps(item, ensure_ascii=False) + "\n\n" for item in (chunk, end))
        + "data: [DONE]\n\n"
    )


class DemoRuntime:
    def __init__(self, configuration):
        self.configuration = configuration
        self.counts = dict.fromkeys(SERVICE_IDS, 0)
        self.draining = set()
        self.logs = {key: deque(maxlen=200) for key in SERVICE_IDS}
        self.condition = asyncio.Condition()

    def record(self, service_id, message):
        self.logs[service_id].append({"time": datetime.now(UTC).isoformat(), "message": message})

    @asynccontextmanager
    async def invocation(self, service_id):
        async with self.condition:
            config = await self.configuration(service_id)
            if not config["enabled"] or service_id in self.draining:
                raise RuntimeError("测试服务尚未启用或正在重新初始化")
            self.counts[service_id] += 1
        try:
            await asyncio.sleep(config["delay_ms"] / 1000)
            if config["failure"]:
                raise RuntimeError("配置的确定性失败场景")
            yield config
            self.record(service_id, "调用完成")
        except Exception:
            self.record(service_id, "调用失败")
            raise
        finally:
            async with self.condition:
                self.counts[service_id] -= 1
                self.condition.notify_all()

    async def reinitialize(self, service_id):
        async with self.condition:
            self.draining.add(service_id)
            try:
                await self.condition.wait_for(lambda: self.counts[service_id] == 0)
                self.record(service_id, "已重新初始化")
            finally:
                self.draining.discard(service_id)

    async def status(self, service_id):
        config = await self.configuration(service_id)
        return {
            "id": service_id,
            "ready": config["enabled"] and service_id not in self.draining,
            "active_calls": self.counts[service_id],
            "state": "reinitializing"
            if service_id in self.draining
            else "running"
            if config["enabled"]
            else "stopped",
            "logs": list(self.logs[service_id]),
        }

    async def completion(self, body):
        async with self.invocation("mock_model") as config:
            tools = body.get("tools") or []
            tool_done = any(message.get("role") == "tool" for message in body.get("messages", []))
            message = {"role": "assistant", "content": config["response_text"]}
            reason = "stop"
            if tools and not tool_done and body.get("tool_choice") != "none":
                function = tools[0].get("function", {})
                properties = function.get("parameters", {}).get("properties", {})
                arguments = {
                    key: value.get(
                        "default", 1 if value.get("type") in ("number", "integer") else "demo"
                    )
                    for key, value in properties.items()
                }
                message = {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_fpl_demo",
                            "type": "function",
                            "function": {
                                "name": function.get("name", "demo"),
                                "arguments": json.dumps(arguments),
                            },
                        }
                    ],
                }
                reason = "tool_calls"
            return {
                "id": "fpl-mock-completion",
                "object": "chat.completion",
                "created": 0,
                "model": body.get("model", "fpl-mock"),
                "choices": [{"index": 0, "message": message, "finish_reason": reason}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            }

    async def tool_reply(self, tool, inputs):
        async with self.invocation("example_tools"):
            products = [
                {"id": "demo-001", "name": "演示耳机", "price": 199},
                {"id": "demo-002", "name": "演示音箱", "price": 299},
            ]
            if tool == "orders":
                return {
                    "id": str(inputs.get("order_id", "demo-order")),
                    "status": "已发货",
                    "demo": True,
                }
            if tool == "products":
                return {
                    "items": [p for p in products if str(inputs.get("q", "")) in p["name"]],
                    "demo": True,
                }
            if tool == "product":
                return {
                    "item": next(
                        (p for p in products if p["id"] == inputs.get("id", "demo-001")), None
                    ),
                    "demo": True,
                }
            raise ValueError("未知示例工具")

    def mock_transport(self, base_url, transport=None):
        if base_url.rstrip("/") != MOCK_BASE_URL:
            return transport

        async def handler(request):
            try:
                body = json.loads(request.content)
                payload = await self.completion(body)
                if body.get("stream"):
                    return httpx.Response(
                        200,
                        text=completion_sse(payload),
                        headers={"Content-Type": "text/event-stream"},
                    )
                return httpx.Response(200, json=payload)
            except (RuntimeError, ValueError):
                return httpx.Response(
                    503, json={"error": {"message": "本地测试服务未就绪或配置为失败"}}
                )

        return httpx.MockTransport(handler)

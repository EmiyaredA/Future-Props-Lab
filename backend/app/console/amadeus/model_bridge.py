"""Stream Pi model turns through the configured FPL provider boundary."""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncIterator
from time import monotonic
from uuid import uuid4

from app.console.amadeus.schemas import ModelTurnIn
from app.llm.inference.catalog import get_model
from app.llm.models import LlmCallLog
from app.llm.providers.agent import HttpAgentAdapter
from app.runtime.credentials import decrypt_secret
from studio.contracts.agent_runtime.dialogue import AgentMessage, ImageInput, ToolCall, ToolSpec
from studio.contracts.model_service.credential_snapshot import CredentialSnapshot
from studio.runtime.database.operation_receipts import OperationError

MAX_IMAGE_BYTES = 350 * 1024
MAX_TOTAL_IMAGE_BYTES = 700 * 1024
MAX_IMAGES_PER_TURN = 4


def _message_images(messages: list[dict]) -> list[tuple[ImageInput, ...]]:
    result: list[tuple[ImageInput, ...]] = []
    total = 0
    count = 0
    for message in messages:
        raw_images = message.get("images", [])
        if not isinstance(raw_images, list):
            raise OperationError("模型图片输入无效", "invalid_image", 422)
        images: list[ImageInput] = []
        for raw in raw_images:
            if not isinstance(raw, dict):
                raise OperationError("模型图片输入无效", "invalid_image", 422)
            mime_type = raw.get("mime_type")
            encoded = raw.get("data_base64")
            if mime_type not in {"image/jpeg", "image/png", "image/webp"} or not isinstance(
                encoded, str
            ):
                raise OperationError("模型图片格式不支持", "invalid_image", 422)
            try:
                decoded = base64.b64decode(encoded, validate=True)
            except (ValueError, TypeError) as exc:
                raise OperationError("模型图片数据无效", "invalid_image", 422) from exc
            size = len(decoded)
            if not size or size > MAX_IMAGE_BYTES:
                raise OperationError("单张模型图片不得超过 350 KiB", "image_too_large", 422)
            count += 1
            total += size
            if count > MAX_IMAGES_PER_TURN or total > MAX_TOTAL_IMAGE_BYTES:
                raise OperationError("模型图片总量超出限制", "image_too_large", 422)
            images.append(ImageInput(mime_type, encoded, size))
        result.append(tuple(images))
    return result


def _audit_messages(messages: list[dict]) -> list[dict]:
    return [
        {
            **message,
            "images": [
                {
                    "mime_type": image.get("mime_type"),
                    "byte_size": image.get("byte_size"),
                }
                for image in message.get("images", [])
            ],
        }
        if message.get("images")
        else message
        for message in messages
    ]


async def stream_model_turn(
    session,
    owner_user_id: str,
    body: ModelTurnIn,
    credential: CredentialSnapshot | None = None,
    *,
    sessions,
    transport_resolver,
) -> AsyncIterator[str]:
    model, provider = await get_model(session, owner_user_id, body.model_id, "text")
    if any(item.get("images") for item in body.messages) and "vision" not in model.capabilities:
        raise OperationError("模型不支持图像输入", "unsupported_modality", 422)
    # Snapshot ORM scalars before releasing the request session; rollback expires
    # instances, and lazy loads from the generator finally-block raise MissingGreenlet.
    slug = model.slug
    provider_kind = provider.kind
    adapter = HttpAgentAdapter(
        kind=provider_kind,
        base_url=provider.base_url,
        api_key=decrypt_secret(provider.api_key_ciphertext),
        transport=transport_resolver(provider.base_url),
    )
    image_groups = _message_images(body.messages)
    messages = [
        AgentMessage(
            role=str(item.get("role", "")),
            text=str(item.get("text", "")),
            images=image_groups[index],
            tool_call_id=str(item.get("tool_call_id", "")),
            tool_name=str(item.get("tool_name", "")),
            tool_calls=tuple(
                ToolCall(
                    id=str(call.get("id", "")),
                    name=str(call.get("name", "")),
                    arguments=call.get("arguments", {}),
                )
                for call in item.get("tool_calls", [])
            ),
        )
        for index, item in enumerate(body.messages)
    ]
    tools = [
        ToolSpec(
            name=str(item.get("name", "")),
            description=str(item.get("description", "")),
            parameters_schema=item.get("parameters_schema", {}),
        )
        for item in body.tools
    ]
    await session.rollback()
    started = monotonic()
    log_id = str(uuid4())
    text = ""
    calls: list[dict] = []
    usage: dict[str, int | None] = {}
    error: str | None = None
    success = False
    try:
        async for event in adapter.stream_turn(
            system=body.system,
            messages=messages,
            tools=tools,
            model=slug,
            temperature=0.7,
            max_tokens=4096,
            round_index=0,
        ):
            if hasattr(event, "text"):
                text += event.text
                yield json.dumps({"type": "delta", "text": event.text}, ensure_ascii=False) + "\n"
            if hasattr(event, "usage"):
                usage = {
                    "prompt_tokens": event.usage.prompt_tokens,
                    "completion_tokens": event.usage.completion_tokens,
                    "total_tokens": event.usage.total_tokens,
                }
            if hasattr(event, "tool_calls"):
                calls = [
                    {"id": call.id, "name": call.name, "arguments": call.arguments}
                    for call in event.tool_calls
                ]
                success = True
                yield (
                    json.dumps(
                        {
                            "type": "end",
                            "tool_calls": calls,
                            "usage": usage,
                            "log_id": log_id,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
    except (asyncio.CancelledError, GeneratorExit):
        error = "客户端断开，Amadeus 模型调用已停止"
        raise
    except Exception:
        error = "Amadeus 模型调用失败"
        raise
    finally:
        snapshot = credential or CredentialSnapshot()

        async def settle() -> None:
            async with sessions() as log_session:
                log_session.add(
                    LlmCallLog(
                        id=log_id,
                        owner_user_id=owner_user_id,
                        call_source="amadeus",
                        provider_kind=provider_kind,
                        model=slug,
                        trace_id=body.run_id or log_id,
                        request_payload={
                            **body.model_dump(mode="json"),
                            "messages": _audit_messages(body.messages),
                        },
                        response_payload={"text": text, "tool_calls": calls},
                        latency_ms=int((monotonic() - started) * 1000),
                        status="success" if success else "error",
                        error_message=error,
                        **usage,
                        **snapshot.as_kwargs(),
                    )
                )
                await log_session.commit()

        # Settlement must never replace a successful end event or the upstream error.
        try:
            await asyncio.shield(settle())
        except Exception:
            pass

import asyncio
import base64
from time import monotonic
from uuid import uuid4

from studio.apps.model_service.inference.assets import InferenceAssets
from studio.apps.model_service.inference.catalog import get_model
from studio.apps.model_service.providers.streaming import ChatMessageInput, stream_text_completion
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.contracts.agent_runtime.dialogue import ImageInput
from studio.contracts.model_service.credential_snapshot import CredentialSnapshot
from studio.contracts.model_service.schemas.model_inference import (
    InferenceTextEvent,
    InferenceTextOut,
)
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.database.ownership import bind_owner
from studio.runtime.messaging.authorized_stream import authorized_stream


async def prepare(session, owner_user_id, body, *, decrypt, settings, readiness=None):
    model, provider = await get_model(
        session, owner_user_id, body.model_id, "text", readiness=readiness
    )
    args = dict(
        kind=provider.kind,
        base_url=provider.base_url,
        api_key=decrypt(provider.api_key_ciphertext),
        model=model.slug,
        system_prompt=body.system_prompt,
        temperature=body.temperature,
        max_tokens=body.max_tokens,
    )
    assets = InferenceAssets(session, owner_user_id, settings=settings)
    messages = []
    for message in body.messages:
        images = []
        for identity in message.asset_ids:
            asset = await assets.get(identity)
            if (
                asset.media_kind != "image"
                or asset.byte_size > 8 * 1024 * 1024
                or "vision" not in model.capabilities
            ):
                raise OperationError("模型不支持视觉输入，或图片超过 8 MiB")
            path = assets.storage.root(owner_user_id) / "inputs" / asset.storage_key
            images.append(
                ImageInput(
                    mime_type=asset.mime_type,
                    byte_size=asset.byte_size,
                    data_base64=base64.b64encode(await asyncio.to_thread(path.read_bytes)).decode(),
                )
            )
        messages.append(
            ChatMessageInput(role=message.role, text=message.text, images=tuple(images))
        )
    args["messages"] = messages
    await session.rollback()
    return args


async def events(
    owner_user_id,
    body,
    args,
    *,
    session_factory,
    transport=None,
    check_access=None,
    credential: CredentialSnapshot | None = None,
):
    started, log_id = monotonic(), str(uuid4())
    text, usage, finish_reason, error = "", {}, None, None
    success = False
    snap = credential or CredentialSnapshot()
    try:
        yield InferenceTextEvent(type="start", log_id=log_id)
        source = stream_text_completion(**args, transport=transport)
        async for delta in authorized_stream(source, check_access):
            if delta.text:
                text += delta.text
                yield InferenceTextEvent(type="delta", text=delta.text)
            for name in ("prompt_tokens", "completion_tokens", "total_tokens"):
                if getattr(delta, name) is not None:
                    usage[name] = getattr(delta, name)
            finish_reason = delta.finish_reason or finish_reason
        success = True
    except (asyncio.CancelledError, GeneratorExit):
        error = "客户端断开，调用已停止"
        raise
    except Exception:
        error = "模型调用失败，请检查模型配置与调用日志"
    finally:

        async def settle():
            async with session_factory() as session:
                bind_owner(session, owner_user_id)
                session.add(
                    LlmCallLog(
                        id=log_id,
                        owner_user_id=owner_user_id,
                        call_source="model_inference",
                        provider_kind=args["kind"],
                        model=args["model"],
                        trace_id=log_id,
                        request_payload=body.model_dump(mode="json"),
                        response_payload={"text": text, "finish_reason": finish_reason},
                        **usage,
                        latency_ms=int((monotonic() - started) * 1000),
                        status="success" if success else "error",
                        error_message=error,
                        **snap.as_kwargs(),
                    )
                )
                await session.commit()

        await asyncio.shield(settle())
    if error:
        yield InferenceTextEvent(type="error", log_id=log_id, message=error)
    else:
        yield InferenceTextEvent(
            type="done",
            log_id=log_id,
            result=InferenceTextOut(
                text=text,
                log_id=log_id,
                finish_reason=finish_reason,
                **usage,
            ),
        )

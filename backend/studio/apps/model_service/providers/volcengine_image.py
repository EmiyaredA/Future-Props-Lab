"""Native Ark Seedream image-array protocol; no asynchronous task is invented."""

import httpx

from studio.apps.model_service.providers._senseaudio import sanitize_provider_message

ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
SEEDREAM_MODEL = "doubao-seedream-4-5-251128"
SEEDREAM_SIZES = ("2048x2048", "2560x1440", "1440x2560", "2304x1728", "1728x2304")


async def generate_image(
    *,
    base_url: str,
    api_key: str,
    model: str,
    payload: dict,
    references: list[str],
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    if model != SEEDREAM_MODEL:
        raise ValueError("当前方舟图片适配仅支持 Seedream 4.5")
    if payload.get("seed") is not None:
        raise ValueError("Seedream 4.5 不支持指定随机种子")
    if payload["size"] not in SEEDREAM_SIZES:
        raise ValueError("Seedream 4.5 不支持所选尺寸")
    if len(references) > 14:
        raise ValueError("Seedream 4.5 最多接收 14 张参考图")
    body = {
        "model": model,
        "prompt": payload["prompt"],
        "size": payload["size"],
        "response_format": "url",
        "sequential_image_generation": "disabled",
        "watermark": True,
    }
    if references:
        body["image"] = references
    async with httpx.AsyncClient(timeout=300, transport=transport) as client:
        response = await client.post(
            f"{(base_url or ARK_BASE_URL).rstrip('/')}/images/generations",
            headers={"Authorization": f"Bearer {api_key}"},
            json=body,
        )
        try:
            result = response.json()
        except ValueError as exc:
            raise ValueError("方舟图片接口返回了无效 JSON") from exc
        if response.is_error:
            error = result.get("error", {}) if isinstance(result, dict) else {}
            message = error.get("message", "") if isinstance(error, dict) else str(error)
            raise ValueError(
                f"方舟图片请求失败（HTTP {response.status_code}）："
                f"{sanitize_provider_message(message)}"
            )
        if not isinstance(result, dict):
            raise ValueError("方舟图片接口返回了无效响应")
    data = result.get("data") or []
    if len(data) != 1 or not data[0].get("url"):
        raise ValueError("方舟图片接口未返回单张有效输出")
    return str(data[0]["url"])

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import httpx

_BEARER = re.compile(r"(?i)(bearer\s+)[^\s,;]+")
_DATA_URI = re.compile(r"(?i)(data:[^;,\s]+;base64,)[A-Za-z0-9+/=]+")
_SECRET_FIELD = re.compile(r'(?i)((?:api[_-]?key|token)["\']?\s*[:=]\s*["\']?)[^"\'\s,}]+')


class SenseAudioProviderError(Exception):
    pass


def sanitize_provider_message(value: str) -> str:
    value = _BEARER.sub(r"\1[REDACTED]", value)
    value = _DATA_URI.sub(r"\1[REDACTED]", value)
    return _SECRET_FIELD.sub(r"\1[REDACTED]", value)


@dataclass(frozen=True)
class ProviderTaskStatus:
    status: str
    progress: int = 0
    result_url: str = ""
    error_message: str = ""


def root_url(base_url: str) -> str:
    return (base_url or "https://api.senseaudio.cn/v1").rstrip("/")


def headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def response_json(response: httpx.Response) -> dict[str, Any]:
    if response.is_error:
        detail = ""
        try:
            error_payload = response.json()
            if isinstance(error_payload, dict):
                detail = str(
                    error_payload.get("message")
                    or error_payload.get("error_message")
                    or error_payload.get("detail")
                    or ""
                )
        except ValueError:
            detail = ""
        safe_detail = sanitize_provider_message(detail)
        message = f"SenseAudio 请求失败（HTTP {response.status_code}）"
        raise SenseAudioProviderError(f"{message}: {safe_detail}" if safe_detail else message)
    try:
        payload = response.json()
    except ValueError as exc:
        raise SenseAudioProviderError("SenseAudio 返回了无效 JSON") from exc
    if not isinstance(payload, dict):
        raise SenseAudioProviderError("SenseAudio 返回了无效响应")
    return payload

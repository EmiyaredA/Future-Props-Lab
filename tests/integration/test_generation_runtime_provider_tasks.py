from __future__ import annotations

import httpx
import pytest

from studio.apps.model_service.generation.provider_tasks import (
    safe_generation_error,
    submit_generation_task,
    validate_provider_content,
)
from studio.apps.model_service.providers.temporary_media import TemporaryMediaError


def test_shared_generation_error_conversion_hides_temporary_urls() -> None:
    assert (
        safe_generation_error(TemporaryMediaError("https://temp.example/private.mp4"))
        == "参考素材临时上传失败，请重新生成"
    )
    assert safe_generation_error(httpx.ReadTimeout("timeout")) == "供应商请求超时"
    assert safe_generation_error(RuntimeError("secret")) == "任务处理失败（RuntimeError）"


def test_shared_provider_content_limit_is_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "studio.apps.model_service.generation.provider_tasks.MAX_PROVIDER_CONTENT_BYTES", 32
    )
    with pytest.raises(ValueError, match="64 MB"):
        validate_provider_content([{"type": "text", "text": "x" * 40}])


@pytest.mark.asyncio
async def test_shared_image_submission_normalizes_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    submitted: dict[str, object] = {}

    async def fake_create(**kwargs) -> str:
        submitted.update(kwargs)
        return "task-1"

    monkeypatch.setattr(
        "studio.apps.model_service.generation.provider_tasks.create_image_task", fake_create
    )
    task_id = await submit_generation_task(
        provider_kind="senseaudio_image",
        base_url="https://provider.example/v1",
        api_key="secret",
        model_slug="image-model",
        payload={"prompt": "雨夜", "size": "1024x1024", "seed": 7},
        image_reference="data:image/png;base64,AA==",
    )

    assert task_id == "task-1"
    assert submitted == {
        "base_url": "https://provider.example/v1",
        "api_key": "secret",
        "model": "image-model",
        "prompt": "雨夜",
        "size": "1024x1024",
        "seed": 7,
        "reference": "data:image/png;base64,AA==",
    }

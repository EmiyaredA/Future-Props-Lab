from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from app.llm.providers.temporary_media import TemporaryMediaError, upload_temporary_media


@pytest.mark.asyncio
async def test_upload_without_config_fails_before_network(tmp_path: Path) -> None:
    source = tmp_path / "reference.mp4"
    source.write_bytes(b"video")
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, text="https://temp.example/reference.mp4")

    with pytest.raises(TemporaryMediaError, match="未配置"):
        await upload_temporary_media(
            path=source,
            mime_type="video/mp4",
            upload_url="",
            transport=httpx.MockTransport(handler),
        )
    assert requests == []


@pytest.mark.asyncio
async def test_upload_uses_random_filename_and_accepts_trailing_newline(tmp_path: Path) -> None:
    source = tmp_path / "private customer name.mp3"
    source.write_bytes(b"ID3example")
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        body = await request.aread()
        assert b"private customer name" not in body
        assert b'.mp3"' in body
        assert b"ID3example" in body
        return httpx.Response(200, text="https://temp.sh/reference.mp3\n")

    result = await upload_temporary_media(
        path=source,
        mime_type="audio/mpeg",
        upload_url="https://temp.sh/upload",
        transport=httpx.MockTransport(handler),
        retry_delay=0,
    )

    assert result == "https://temp.sh/reference.mp3"
    assert len(requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        "http://temp.sh/reference.mp4",
        "https://other.example/reference.mp4",
        "https://temp.sh/",
        "https://temp.sh/reference.mp4#secret",
        "not-a-url",
    ],
)
async def test_upload_rejects_invalid_result_urls(tmp_path: Path, response: str) -> None:
    source = tmp_path / "reference.mp4"
    source.write_bytes(b"video")
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, text=response))

    with pytest.raises(TemporaryMediaError, match="无效"):
        await upload_temporary_media(
            path=source,
            mime_type="video/mp4",
            upload_url="https://temp.sh/upload",
            transport=transport,
            retry_delay=0,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("first_status", [429, 500, 503])
async def test_upload_retries_once_for_retryable_statuses(
    tmp_path: Path, first_status: int
) -> None:
    source = tmp_path / "reference.mp4"
    source.write_bytes(b"video")
    attempts = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(first_status, text="do not expose this response")
        return httpx.Response(200, text="https://temp.sh/reference.mp4")

    result = await upload_temporary_media(
        path=source,
        mime_type="video/mp4",
        upload_url="https://temp.sh/upload",
        transport=httpx.MockTransport(handler),
        retry_delay=0,
    )

    assert result == "https://temp.sh/reference.mp4"
    assert attempts == 2


@pytest.mark.asyncio
async def test_upload_retries_timeout_then_returns_sanitized_failure(tmp_path: Path) -> None:
    source = tmp_path / "reference.wav"
    source.write_bytes(b"audio")
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        raise httpx.ReadTimeout("private upstream detail", request=request)

    with pytest.raises(TemporaryMediaError, match="暂时不可用") as error:
        await upload_temporary_media(
            path=source,
            mime_type="audio/wav",
            upload_url="https://temp.sh/upload",
            transport=httpx.MockTransport(handler),
            retry_delay=0,
        )

    assert attempts == 2
    assert "private upstream detail" not in str(error.value)


@pytest.mark.asyncio
async def test_upload_rejects_oversized_response(tmp_path: Path) -> None:
    source = tmp_path / "reference.wav"
    source.write_bytes(b"audio")
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, text="x" * 4097))

    with pytest.raises(TemporaryMediaError, match="无效响应"):
        await upload_temporary_media(
            path=source,
            mime_type="audio/wav",
            upload_url="https://temp.sh/upload",
            transport=transport,
            retry_delay=0,
        )

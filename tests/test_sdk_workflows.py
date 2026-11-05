"""The documentation recipes run through the standalone SDK and the actual HTTP application."""

import io
import sys
import zipfile
from pathlib import Path

import httpx
import pytest
from tests.test_audio_annotation import wav_bytes

from website_test_support import app

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sdk/python/src"))

from future_props_lab import AsyncClient  # noqa: E402
from future_props_lab import workshop_examples as recipes  # noqa: E402


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,route,text",
    [
        ("visual", "/v1/visual-workshop/projects/{id}/canvas", "自动化创建的创作说明"),
        ("galgame", "/v1/galgame-workshop/projects/{id}/story", "细粒度更新后的对白"),
        ("video", "/v1/video-editor/projects/{id}/timeline", "黑场"),
        ("thought", "/v1/thought-workshop/notes/{id}", "更新后的内容"),
        ("presentation", "/v1/presentation-workshop/projects/{id}", "讲稿已更新"),
        ("annotation", "/v1/audio-annotation/projects/{id}/document", "已校对的原文"),
    ],
)
async def test_sdk_workshop_create_edit_read_export(kind, route, text, tmp_path):
    output = tmp_path / "result"
    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(base_url="http://test", transport=transport) as sdk:
        recipe = getattr(recipes, kind + "_workflow")
        if kind == "annotation":
            identity, saved = await recipe(sdk, io.BytesIO(wav_bytes()), output)
        else:
            identity, saved = await recipe(sdk, output)
        assert saved.revision >= 1
        try:
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as browser:
                response = await browser.get(route.format(id=identity))
                assert response.status_code == 200, response.text
                assert response.json()["revision"] == saved.revision
                assert text in response.text
            assert output.is_file() and output.stat().st_size > 0
            if kind in {"visual", "galgame", "video", "presentation"}:
                assert zipfile.is_zipfile(output)
            else:
                assert text in output.read_text()
        finally:
            if kind == "annotation":
                project = await sdk.annotation.get_project(project_id=identity)
                await sdk.annotation.delete_project(
                    project_id=identity, expected_revision=project.revision
                )

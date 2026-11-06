"""Opt-in, fictional-document live smoke; never connects to the desktop database."""

import io
import json
import os
import uuid
import zipfile
from pathlib import Path

import httpx
import pytest

from studio.apps.interview_assistant.codex import CodexExecutor, executable
from studio.apps.interview_assistant.executor_status import executor_status
from studio.apps.interview_assistant.runner import InterviewPreparationRunner
from studio.config.settings import get_settings
from website_test_support import SessionLocal, app

WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


@pytest.mark.skipif(os.environ.get("FPL_INTERVIEW_LIVE_TEST") != "1", reason="explicit live opt-in")
@pytest.mark.asyncio
async def test_fictional_docx_real_codex_research(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "fpl_interview_codex_enabled", True)
    monkeypatch.setattr(settings, "fpl_interview_codex_user_id", "test-user")
    status = await executor_status("test-user", sessions=SessionLocal, settings=settings)
    assert status.available, status.message
    document = io.BytesIO()
    fictional_notice = "All names and experience in this document are fictional test data."
    with zipfile.ZipFile(document, "w") as archive:
        archive.writestr(
            "word/document.xml",
            (
                f'<w:document xmlns:w="{WORD_NAMESPACE}">'
                "<w:body><w:p><w:r><w:t>Fictional API reliability project</w:t></w:r></w:p>"
                "<w:p><w:r><w:t>Built a Python FastAPI service with SQLite. "
                "Owned request validation, transaction boundaries and recovery tests. "
                f"{fictional_notice}</w:t></w:r></w:p>"
                "</w:body></w:document>"
            ),
        )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        room = (
            await client.post(
                "/v1/interview-assistant/rooms",
                json={
                    "title": "虚构 Python API 工程师 · 联网验收",
                    "request_id": str(uuid.uuid4()),
                },
            )
        ).json()
        base = f"/v1/interview-assistant/rooms/{room['id']}"
        uploaded = await client.post(
            base + "/materials?expected_revision=0",
            files={
                "file": (
                    "fictional-resume.docx",
                    document.getvalue(),
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
        )
        assert uploaded.status_code == 200, uploaded.text
        room = uploaded.json()
        submitted = await client.post(
            base + "/preparations",
            json={
                "role": "Python API 工程师",
                "jd": (
                    "负责 Python FastAPI 接口设计、请求校验和 SQLite 事务可靠性。"
                    "能用测试验证并发、幂等与故障恢复，清楚解释个人贡献及技术取舍。"
                ),
                "resume": "",
                "material_id": room["materials"][0]["id"],
                "duration": "15",
                "request_id": str(uuid.uuid4()),
                "expected_revision": room["revision"],
            },
        )
        assert submitted.status_code == 202, submitted.text
        task = submitted.json()["tasks"][0]

        async def allowed(*_args):
            return True

        await InterviewPreparationRunner(
            allowed,
            CodexExecutor(lambda: executable(settings)),
            sessions=SessionLocal,
            state_root=app.state.interview_files_root,
            executor_status=app.state.interview_executor_status,
        ).execute(task["id"])
        room = (await client.get(base)).json()
        target = Path(__file__).resolve().parents[1] / ".local/interview-assistant/live-smoke"
        target.mkdir(parents=True, exist_ok=True)
        (target / "result.json").write_text(json.dumps(room, ensure_ascii=False, indent=2))
        result = room["tasks"][0]
        assert result["status"] == "succeeded", result["message"]
        exported = await client.get(base + f"/preparations/{task['id']}/export")
        (target / "materials.md").write_text(exported.text)
        assert room["active_bundle_id"] == task["id"]

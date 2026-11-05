"""API, task fencing and document boundaries use only disposable test databases."""

import uuid
import zipfile

import httpx
import pytest
from pypdf import PdfWriter

from app.deps import require_studio_auth
from app.main import app
from app.runtime.config import get_settings
from app.runtime.db import SessionLocal
from studio.apps.interview_assistant import codex, runner
from studio.apps.interview_assistant.bundles import acceptance
from studio.apps.interview_assistant.codex import task_context
from studio.apps.interview_assistant.executor_status import executor_status
from studio.apps.interview_assistant.storage.models import InterviewPreparation
from studio.apps.interview_assistant.task_tools import TaskFiles, extract_document
from studio.apps.interview_assistant.transport import website as routes
from studio.contracts.interview_assistant.documents import InterviewExecutorOut, PreparationBundle


def bundle_for(task):
    return {
        "schema_version": 1,
        "task_id": task.id,
        "input_hash": task.input_hash,
        "material_summary": "虚构候选人的 Python 服务经历",
        "requirements": [
            {
                "id": "r1",
                "capability": "Python",
                "importance": "core",
                "evidence": [{"file_id": "jd", "location": "line:1", "excerpt": "Python"}],
            }
        ],
        "experiences": [
            {
                "id": "e1",
                "title": "测试项目",
                "summary": "构建服务",
                "evidence": [{"file_id": "resume", "location": "line:1", "excerpt": "测试项目"}],
                "uncertainties": ["指标待本人确认"],
            }
        ],
        "topics": [
            {
                "id": "t1",
                "title": "可靠性",
                "summary": "测试与恢复",
                "relevance": "岗位要求",
                "version": None,
                "source_ids": ["s1"],
                "key_points": ["基线"],
            }
        ],
        "sources": [
            {
                "id": f"s{i}",
                "url": f"https://docs.python.org/3/{i}.html",
                "title": f"资料{i}",
                "retrieved_at": "2026-10-22T00:00:00Z",
                "published_at": None,
                "version": "3",
                "excerpt": "示例来源片段",
                "supports": ["t1"],
            }
            for i in range(1, 4)
        ],
        "questions": [
            {
                "id": f"q{i}",
                "category": "技术",
                "question": f"真实蓝图问题{i}",
                "objective": "验证个人贡献",
                "requirement_ids": ["r1"],
                "experience_ids": ["e1"],
                "source_ids": ["s1"],
                "answer_points": ["说明验证方法"],
                "follow_ups": ["如何比较？"],
            }
            for i in range(1, 7)
        ],
        "first_round": ["q2", "q1", "q3"],
        "rubric": [
            {
                "dimension": "证据",
                "question_ids": ["q1", "q2", "q3"],
                "answer_points": ["独立验证"],
                "common_gaps": ["未说明职责"],
            }
        ],
        "limitations": ["虚构测试资料，不用于真实评价"],
        "material_complete": True,
    }


@pytest.fixture
def configured(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "fpl_interview_codex_enabled", True)
    monkeypatch.setattr(settings, "fpl_interview_codex_user_id", "test-user")

    async def available(_user, *_args):
        return InterviewExecutorOut(available=True, code="ready", message="test", version="0.163.0")

    monkeypatch.setattr(routes, "executor_status", available)
    monkeypatch.setattr(runner, "executor_status", available)


@pytest.fixture
async def client(configured):
    assert configured is None
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


async def create(client):
    request = {"request_id": str(uuid.uuid4()), "title": "Python 岗位"}
    response = await client.post("/v1/interview-assistant/rooms", json=request)
    assert response.status_code == 201, response.text
    room = response.json()
    again = await client.post("/v1/interview-assistant/rooms", json=request)
    assert again.json()["id"] == room["id"]
    return room


async def prepare(client, room, **overrides):
    body = {
        "request_id": str(uuid.uuid4()),
        "expected_revision": room["revision"],
        "role": "Python 岗位",
        "jd": "Python",
        "resume": "测试项目",
        "duration": "30",
        **overrides,
    }
    response = await client.post(
        f"/v1/interview-assistant/rooms/{room['id']}/preparations", json=body
    )
    assert response.status_code == 202, response.text
    return response.json(), body


class FakeExecutor:
    def __init__(self, change=None):
        self.change = change

    async def run(self, task, root, on_event, is_active):
        files = TaskFiles(root)
        for file_id in files.manifest["files"]:
            files.read_input(file_id)
        await on_event("search", "已检索测试来源")
        assert await is_active()
        bundle = bundle_for(task)
        if self.change:
            await self.change(task, bundle)
        return bundle, 1


async def allowed(*_args):
    return True


@pytest.mark.asyncio
async def test_real_flow_snapshot_receipt_bundle_and_export(client):
    room = await create(client)
    queued, body = await prepare(client, room)
    task = queued["tasks"][0]
    again = await client.post(f"/v1/interview-assistant/rooms/{room['id']}/preparations", json=body)
    assert len(again.json()["tasks"]) == 1
    assert again.json()["revision"] == queued["revision"]
    body["jd"] = "changed"
    assert (
        await client.post(f"/v1/interview-assistant/rooms/{room['id']}/preparations", json=body)
    ).status_code == 409
    await runner.InterviewPreparationRunner(allowed, FakeExecutor()).execute(task["id"])
    result = (await client.get(f"/v1/interview-assistant/rooms/{room['id']}")).json()
    assert result["active_bundle_id"] == task["id"]
    assert result["tasks"][0]["snapshot"]["jd"] == "Python"
    assert result["tasks"][0]["status"] == "succeeded"
    assert result["tasks"][0]["result"]["first_round"] == ["q2", "q1", "q3"]
    exported = await client.get(
        f"/v1/interview-assistant/rooms/{room['id']}/preparations/{task['id']}/export"
    )
    assert exported.status_code == 200
    assert "真实蓝图问题" in exported.text
    assert "docs.python.org" in exported.text


@pytest.mark.asyncio
async def test_cancel_retry_late_completion_and_empty_material(client):
    room = await create(client)
    missing = {"request_id": "empty", "expected_revision": 0, "role": "岗位", "jd": "Python"}
    assert (
        await client.post(f"/v1/interview-assistant/rooms/{room['id']}/preparations", json=missing)
    ).status_code == 422
    queued, _ = await prepare(client, room)
    old = queued["tasks"][0]

    async def cancel_during_completion(task, _bundle):
        current = (await client.get(f"/v1/interview-assistant/rooms/{room['id']}")).json()["tasks"][
            0
        ]
        response = await client.post(
            f"/v1/interview-assistant/rooms/{room['id']}/preparations/{task.id}/cancel",
            json={"expected_revision": current["revision"]},
        )
        assert response.status_code == 200

    await runner.InterviewPreparationRunner(
        allowed, FakeExecutor(cancel_during_completion)
    ).execute(old["id"])
    room = (await client.get(f"/v1/interview-assistant/rooms/{room['id']}")).json()
    assert room["tasks"][0]["status"] == "cancelled"
    assert room["active_bundle_id"] is None
    queued, _ = await prepare(client, room)
    await runner.InterviewPreparationRunner(allowed, FakeExecutor()).execute(
        queued["tasks"][0]["id"]
    )
    await runner.InterviewPreparationRunner(allowed).finish(old["id"], "succeeded", "late", {})
    room = (await client.get(f"/v1/interview-assistant/rooms/{room['id']}")).json()
    assert room["active_bundle_id"] == queued["tasks"][0]["id"]


@pytest.mark.asyncio
async def test_bad_reference_needs_input_preserves_previous_version_and_restart(client):
    room, _ = await prepare(client, await create(client))
    worker = runner.InterviewPreparationRunner(allowed, FakeExecutor())
    await worker.execute(room["tasks"][0]["id"])
    room = (await client.get(f"/v1/interview-assistant/rooms/{room['id']}")).json()
    accepted = room["active_bundle_id"]
    queued, _ = await prepare(client, room)

    async def bad(_task, bundle):
        bundle["questions"][0]["source_ids"] = ["does-not-exist"]

    await runner.InterviewPreparationRunner(allowed, FakeExecutor(bad)).execute(
        queued["tasks"][0]["id"]
    )
    room = (await client.get(f"/v1/interview-assistant/rooms/{room['id']}")).json()
    assert room["active_bundle_id"] == accepted
    assert room["tasks"][0]["status"] == "needs_input"
    assert room["tasks"][0]["result"] is not None
    room, _ = await prepare(client, room)
    await worker.recover()
    current = (await client.get(f"/v1/interview-assistant/rooms/{room['id']}")).json()
    assert current["tasks"][0]["status"] == "interrupted"
    assert current["active_bundle_id"] == accepted


@pytest.mark.asyncio
async def test_material_upload_cas_private_access_and_delete(client):
    room = await create(client)
    url = f"/v1/interview-assistant/rooms/{room['id']}"
    response = await client.post(
        url + "/materials?expected_revision=0", files={"file": ("resume.txt", b"test")}
    )
    assert response.status_code == 200
    current = response.json()
    material = current["materials"][0]
    downloaded = await client.get(url + f"/materials/{material['id']}/download")
    assert downloaded.content == b"test"
    assert (
        await client.post(
            url + "/materials?expected_revision=0", files={"file": ("new.txt", b"new")}
        )
    ).status_code == 409
    base_override = app.dependency_overrides[require_studio_auth]

    async def other_user():
        # Obtain the same tenant and permission set but a distinct account.
        from studio.contracts.identity.principal import StudioPrincipal

        return StudioPrincipal(
            platform_role="admin",
            user_id="other",
            must_change_password=False,
            auth_kind="session",
            scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
        )

    app.dependency_overrides[require_studio_auth] = other_user
    try:
        assert (await client.get(url)).status_code == 404
        assert (await client.get(url + f"/materials/{material['id']}/download")).status_code == 404
    finally:
        app.dependency_overrides[require_studio_auth] = base_override
    assert (
        await client.delete(url + f"?expected_revision={current['revision']}")
    ).status_code == 200
    assert (await client.get(url)).status_code == 404


def test_docx_pdf_scans_and_task_file_boundaries(tmp_path):
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    docx = tmp_path / "resume.docx"
    with zipfile.ZipFile(docx, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>测试项目</w:t></w:r></w:p></w:body></w:document>',
        )
    assert extract_document(docx)["sections"][0]["location"] == "paragraph:1"
    writer = PdfWriter()
    writer.add_blank_page(100, 100)
    pdf = tmp_path / "resume.pdf"
    writer.write(pdf)
    assert extract_document(pdf)["complete"] is False
    writer.encrypt("password")
    encrypted = tmp_path / "encrypted.pdf"
    writer.write(encrypted)
    assert extract_document(encrypted)["complete"] is False
    text_writer = PdfWriter()
    page = text_writer.add_blank_page(300, 300)
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {
                    NameObject("/F1"): DictionaryObject(
                        {
                            NameObject("/Type"): NameObject("/Font"),
                            NameObject("/Subtype"): NameObject("/Type1"),
                            NameObject("/BaseFont"): NameObject("/Helvetica"),
                        }
                    )
                }
            )
        }
    )
    text = DecodedStreamObject()
    text.set_data(b"BT /F1 12 Tf 20 250 Td (Fictional API project) Tj ET")
    page.replace_contents(text)
    valid = tmp_path / "text-resume.pdf"
    text_writer.write(valid)
    extracted = extract_document(valid)
    assert extracted["complete"] is True
    assert "Fictional API project" in extracted["sections"][0]["text"]
    (tmp_path / "manifest.json").write_text('{"files":{}}')
    (tmp_path / "work").mkdir()
    files = TaskFiles(tmp_path)
    files.write_work("draft.md", "safe")
    assert files.read_work("draft.md") == "safe"
    for name in ("/etc/passwd", "../input/jd.md", "../../auth.json", "delivery/bundle.json"):
        with pytest.raises(ValueError):
            files.write_work(name, "bad")
        with pytest.raises(ValueError):
            files.read_input(name)
    (tmp_path / "work" / "link").symlink_to(docx)
    with pytest.raises(ValueError):
        files.read_work("link")


@pytest.mark.asyncio
async def test_acceptance_requires_actual_reads_search_and_correct_snapshot(client):
    room, _ = await prepare(client, await create(client))
    async with SessionLocal() as session:
        task = await session.get(InterviewPreparation, room["tasks"][0]["id"])
        root = task_context(task)
        bundle = PreparationBundle.model_validate(bundle_for(task))
        problems = acceptance(bundle, task.id, task.input_hash, root, 0)
        assert any("未读取" in problem for problem in problems)
        assert any("联网" in problem for problem in problems)
        files = TaskFiles(root)
        files.read_input("jd")
        files.read_input("resume")
        assert not acceptance(bundle, task.id, task.input_hash, root, 1)
        assert acceptance(bundle, task.id, "changed", root, 1)


def test_cli_configuration_does_not_inherit_backend_credentials(tmp_path, monkeypatch):
    home = tmp_path / "codex-home"
    home.mkdir()
    (home / "config.toml").write_text(
        'model = "test-model"\n[hooks]\nsecret = "must-not-inherit"\n'
    )
    monkeypatch.setenv("CODEX_HOME", str(home))
    monkeypatch.setenv("FPL_SECRET_TOKEN", "must-not-inherit")
    monkeypatch.setattr(codex, "executable", lambda: "/usr/bin/false")
    command, env = codex.invocation(tmp_path)
    combined = " ".join(command)
    assert "must-not-inherit" not in combined
    assert "FPL_SECRET_TOKEN" not in env
    assert "features.shell_tool=false" in combined
    assert "--ignore-user-config" in command
    assert "--output-schema" in command
    assert "permissions.studio.apps.interview_assistant.filesystem" in combined
    assert "danger-full-access" not in combined


@pytest.mark.asyncio
async def test_codex_subprocess_consumes_jsonl_and_structured_delivery(
    client, tmp_path, monkeypatch
):
    import sys
    import textwrap

    room, _ = await prepare(client, await create(client))
    async with SessionLocal() as session:
        task = await session.get(InterviewPreparation, room["tasks"][0]["id"])
        root = task_context(task)
        expected = bundle_for(task)
    (root / "expected.json").write_text(__import__("json").dumps(expected))
    fake = tmp_path / "fake-codex"
    fake.write_text(
        f"#!{sys.executable}\n"
        + textwrap.dedent("""
        import json
        import sys
        from pathlib import Path
        from studio.apps.interview_assistant.task_tools import TaskFiles
        root = Path(sys.argv[sys.argv.index('-C') + 1]).parent
        files = TaskFiles(root)
        for identifier in files.manifest['files']:
            files.read_input(identifier)
        print(json.dumps({'type':'item.completed','item':{'type':'mcp_tool_call'}}), flush=True)
        item = {'type':'web_search','status':'completed'}
        print(json.dumps({'type':'item.completed','item':item}), flush=True)
        Path(sys.argv[sys.argv.index('-o') + 1]).write_bytes((root / 'expected.json').read_bytes())
        print(json.dumps({'type':'turn.completed'}), flush=True)
    """)
    )
    fake.chmod(0o700)
    monkeypatch.setattr(codex, "executable", lambda: str(fake))
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "empty-home"))
    events = []

    async def event(*data):
        events.append(data)

    async def active():
        return True

    actual, searches = await codex.CodexExecutor().run(task, root, event, active)
    assert actual == expected
    assert searches == 1
    assert {item[0] for item in events} == {"material", "search"}
    assert not acceptance(
        PreparationBundle.model_validate(actual), task.id, task.input_hash, root, searches
    )


@pytest.mark.asyncio
async def test_cancellation_terminates_the_cli_process_group(client, tmp_path, monkeypatch):
    import asyncio
    import os
    import sys
    import textwrap

    from app.runtime.operation_receipts import OperationError

    room, _ = await prepare(client, await create(client))
    async with SessionLocal() as session:
        task = await session.get(InterviewPreparation, room["tasks"][0]["id"])
        root = task_context(task)
    fake = tmp_path / "waiting-codex"
    fake.write_text(
        f"#!{sys.executable}\n"
        + textwrap.dedent("""
        import os
        import sys
        import time
        from pathlib import Path
        root = Path(sys.argv[sys.argv.index('-C') + 1]).parent
        (root / 'child.pid').write_text(str(os.getpid()))
        time.sleep(60)
    """)
    )
    fake.chmod(0o700)
    monkeypatch.setattr(codex, "executable", lambda: str(fake))
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "empty-home"))

    async def event(*_data):
        pass

    async def active():
        return not (root / "child.pid").exists()

    with pytest.raises(OperationError, match="任务已取消"):
        await asyncio.wait_for(codex.CodexExecutor().run(task, root, event, active), 8)
    pid = int((root / "child.pid").read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_executor_binding_is_checked_before_cli_discovery(configured, monkeypatch):
    import asyncio

    assert configured is None
    monkeypatch.setattr(
        codex, "executable", lambda: pytest.fail("unbound users must not probe the CLI")
    )
    status = asyncio.run(executor_status("another-account"))
    assert not status.available
    assert status.code == "agent_not_authorized"

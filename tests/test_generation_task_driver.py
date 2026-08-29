from __future__ import annotations

from dataclasses import replace

import pytest

from app.llm.generation_runtime import GenerationTaskContext, GenerationTaskDriver
from app.llm.providers._senseaudio import ProviderTaskStatus


def _task(status: str, **changes) -> GenerationTaskContext:
    task = GenerationTaskContext(
        task_id="task-1",
        status=status,
        provider_kind="senseaudio_image",
        base_url="https://api.example/v1",
        api_key="secret",
        model_slug="image-model",
        payload={"prompt": "test", "size": "1024x1024"},
        provider_task_id="provider-1" if status != "queued" else "",
        result_url="",
        workspace_id="workspace-1",
    )
    return replace(task, **changes)


class FakeStore:
    def __init__(self, task: GenerationTaskContext) -> None:
        self.task: GenerationTaskContext | None = task
        self.failures = 0

    async def recover_submitting(self) -> None:
        if self.task is not None and self.task.status == "submitting":
            self.task = replace(self.task, status="failed")

    async def claim(self, task_id: str) -> GenerationTaskContext | None:
        assert task_id == "task-1"
        if self.task is None or self.task.status in {"completed", "failed"}:
            return None
        snapshot = self.task
        if snapshot.status == "queued":
            self.task = replace(snapshot, status="submitting")
        return snapshot

    async def mark_submitted(self, _task_id: str, provider_task_id: str) -> None:
        if self.task is not None and self.task.status == "submitting":
            self.task = replace(
                self.task,
                status="pending",
                provider_task_id=provider_task_id,
            )

    async def mark_materializing(self, _task_id: str, result_url: str) -> None:
        if self.task is not None:
            self.task = replace(self.task, status="processing", result_url=result_url)

    async def mark_progress(self, _task_id: str, status: str, _progress: int) -> None:
        if self.task is not None:
            self.task = replace(
                self.task,
                status="processing" if status == "processing" else "pending",
            )

    async def fail(self, _task_id: str, _message: str, *, result_url: str = "") -> None:
        if self.task is None or self.task.status in {"completed", "failed"}:
            return
        self.failures += 1
        self.task = replace(
            self.task,
            status="failed",
            result_url=result_url or self.task.result_url,
        )


def _driver(store, *, submit, poll, materialize):
    return GenerationTaskDriver(
        store=store,
        submit=submit,
        poll=poll,
        materialize=materialize,
        map_error=lambda exc: str(exc),
    )


@pytest.mark.asyncio
async def test_submission_is_claimed_once_and_never_repeated_after_failure() -> None:
    store = FakeStore(_task("queued"))
    submissions = 0
    polls = 0

    async def submit(_task):
        nonlocal submissions
        submissions += 1
        return "provider-1"

    async def poll(_task):
        nonlocal polls
        polls += 1
        return ProviderTaskStatus(status="failed", error_message="upstream failed")

    async def materialize(_task_id, _url):
        raise AssertionError("failed provider task must not materialize")

    driver = _driver(store, submit=submit, poll=poll, materialize=materialize)
    await driver.process("task-1")
    assert store.task is not None and store.task.status == "pending"
    await driver.process("task-1")
    await driver.process("task-1")
    assert submissions == 1
    assert polls == 1
    assert store.failures == 1
    assert store.task is not None and store.task.status == "failed"


@pytest.mark.asyncio
async def test_recovery_fails_submitting_without_resubmitting() -> None:
    store = FakeStore(_task("submitting", provider_task_id=""))
    submissions = 0

    async def submit(_task):
        nonlocal submissions
        submissions += 1
        return "unexpected"

    async def poll(_task):
        raise AssertionError("interrupted submission must not be polled")

    async def materialize(_task_id, _url):
        raise AssertionError("interrupted submission must not materialize")

    driver = _driver(store, submit=submit, poll=poll, materialize=materialize)
    await driver.recover()
    await driver.process("task-1")
    assert submissions == 0
    assert store.task is not None and store.task.status == "failed"


@pytest.mark.asyncio
async def test_completed_poll_materializes_once_and_settlement_is_idempotent() -> None:
    store = FakeStore(_task("pending"))
    materializations = 0

    async def submit(_task):
        raise AssertionError("pending task must not submit")

    async def poll(_task):
        return ProviderTaskStatus(
            status="completed",
            progress=100,
            result_url="https://cdn.example/result.png",
        )

    async def materialize(_task_id, _url):
        nonlocal materializations
        materializations += 1
        assert store.task is not None
        store.task = replace(store.task, status="completed")

    driver = _driver(store, submit=submit, poll=poll, materialize=materialize)
    await driver.process("task-1")
    await driver.process("task-1")
    assert materializations == 1
    assert store.task is not None and store.task.status == "completed"


@pytest.mark.asyncio
async def test_materialization_failure_is_safely_settled_and_not_retried() -> None:
    result_url = "https://cdn.example/result.png"
    store = FakeStore(_task("processing", result_url=result_url))
    downloads = 0

    async def submit(_task):
        raise AssertionError("processing task must not submit")

    async def poll(_task):
        raise AssertionError("download-ready task must not poll")

    async def materialize(_task_id, _url):
        nonlocal downloads
        downloads += 1
        raise RuntimeError("download failed")

    driver = _driver(store, submit=submit, poll=poll, materialize=materialize)
    await driver.process("task-1")
    await driver.process("task-1")
    assert downloads == 1
    assert store.failures == 1
    assert store.task is not None
    assert store.task.status == "failed"
    assert store.task.result_url == result_url

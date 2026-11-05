"""The inference consumer preserves unknown native work and committed output bytes."""

from types import SimpleNamespace

import pytest

from app.llm.inference.runner import InferenceRunner
from app.llm.task_outcomes import NativeSubmissionUncertain


@pytest.mark.parametrize("outcome", ["unknown_native", "lost_finish_reply", "confirmed_failure"])
async def test_native_synthesis_consumer_distinguishes_unknown_and_confirmed_outcomes(
    tmp_path, monkeypatch, outcome
):
    settings = SimpleNamespace(runtime_path=tmp_path, fpl_visual_asset_max_bytes=1024)
    task = SimpleNamespace(
        task_id="accepted-task",
        owner_user_id="alpha",
        status="queued",
        model_slug="synthetic-local-model",
        payload={"reference_asset_id": "input"},
    )
    state = SimpleNamespace(status="queued", failures=[], output=None)

    async def claim(_task_id):
        state.status = "submitting"
        return task

    async def fail(_task_id, message):
        state.status = "failed"
        state.failures.append(message)

    runner = InferenceRunner(None, local_runtime=object(), settings=settings)
    runner.store = SimpleNamespace(claim=claim, fail=fail)

    async def inputs(_task):
        return {"input": (tmp_path / "source.wav", "audio/wav", "source.wav", 8)}

    runner.inputs = inputs

    async def synthesize(_runtime, _sessions, _task, _source, output):
        state.output = output
        if outcome == "unknown_native":
            raise NativeSubmissionUncertain("synthetic receipt pending")
        output.write_bytes(b"native-result")
        if outcome == "confirmed_failure":
            raise ValueError("synthetic confirmed native failure")
        return {"ok": True}

    async def finish(*_args):
        state.status = "completed"
        raise RuntimeError("synthetic committed response lost")

    monkeypatch.setattr("app.llm.inference.runner.synthesize", synthesize)
    runner.finish = finish
    await runner.synthesize("accepted-task")
    if outcome == "unknown_native":
        assert state.status == "submitting" and state.failures == []
    elif outcome == "lost_finish_reply":
        assert state.status == "completed" and state.failures == []
        assert state.output.read_bytes() == b"native-result"
    else:
        assert state.status == "failed" and len(state.failures) == 1
        assert not state.output.exists()

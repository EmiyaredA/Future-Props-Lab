"""Thought validates its note; only Models executes providers and writes usage logs."""

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.apps.thought_workshop.assistant import prepare
from app.apps.thought_workshop.schemas.workshop import ThoughtAssistantIn
from app.apps.thought_workshop.writing import WritingModel
from fpl_models.writing import WritingResponse, live_deltas
from fpl_runtime.delegation import RequestGrant, permitted, target_permission_path
from fpl_runtime.routing import RouteCatalog
from fpl_runtime.writing import WRITING_MODELS_PATH, WritingInput

ROOT = Path(__file__).resolve().parents[1]


def test_real_identity_and_owned_models_http_writing(tmp_path):
    response = subprocess.run(
        [sys.executable, str(ROOT / "tests/thought_writing_scenario.py")],
        cwd=ROOT,
        env={
            **os.environ,
            "THOUGHT_WRITING_ROOT": str(tmp_path),
            "FPL_DATABASE_PATH": str(tmp_path / "identity/service.db"),
            "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
            "PYTHONPATH": str(ROOT / "backend"),
        },
        capture_output=True,
        text=True,
        timeout=45,
    )
    assert response.returncode == 0, response.stdout + response.stderr


def test_writing_delegation_cannot_change_source_target_or_method():
    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    source = "/v1/thought-workshop/notes/note-alpha/assistant"
    body = WritingInput(
        model_id="model", note_id="note-alpha", revision=0, action="summary", content="note"
    )
    values = dict(
        caller="thought",
        purpose="thought.writing.complete",
        source_method="POST",
        source_path=source,
        target_service="models",
        target_method="POST",
        target_path=body.path,
    )
    assert permitted(RequestGrant(**values), catalog)
    assert target_permission_path(RequestGrant(**values)) == "/v1/model-inference/text/stream"
    for changes in (
        {"caller": "models"},
        {"source_method": "GET"},
        {"target_method": "GET"},
        {"target_path": "/v1/model-inference/text/stream"},
        {"source_path": "/v1/thought-workshop/notes/note-alpha"},
    ):
        assert not permitted(RequestGrant(**{**values, **changes}), catalog)
    listed = {
        **values,
        "purpose": "thought.writing.list",
        "target_method": "GET",
        "target_path": WRITING_MODELS_PATH,
    }
    assert permitted(RequestGrant(**listed), catalog)
    assert not permitted(RequestGrant(**{**listed, "source_method": "DELETE"}), catalog)
    assert body.digest() != body.model_copy(update={"content": "changed"}).digest()


async def test_note_validation_releases_read_before_model_http():
    order = []

    class Notes:
        owner_user_id = "alpha"
        session = SimpleNamespace()

        async def get(self, _id):
            return SimpleNamespace(revision=3, deleted_at=None, search_text="content")

    async def rollback():
        order.append("rollback")

    Notes.session.rollback = rollback

    class Writing:
        async def select(self, model_id):
            order.append("select")
            assert order == ["rollback", "select"]
            return WritingModel(model_id, "fixture", model_id)

    prepared = await prepare(
        Notes(),
        "note",
        ThoughtAssistantIn(model_id="model", expected_revision=3, action="summary"),
        writing=Writing(),
    )
    assert prepared.content == "content" and order == ["rollback", "select"]


async def test_private_stream_revocation_interrupts_silent_provider():
    entered, closed = asyncio.Event(), asyncio.Event()

    async def source():
        try:
            entered.set()
            await asyncio.Event().wait()
            yield None
        finally:
            closed.set()

    class Identity:
        async def status(self, **_kwargs):
            return False

    async def consume():
        return [
            part
            async for part in live_deltas(source(), Identity(), assertion="proof", path="private")
        ]

    task = asyncio.create_task(consume())
    await entered.wait()
    with pytest.raises(RuntimeError, match="authorization"):
        await asyncio.wait_for(task, 3)
    assert closed.is_set()


async def test_response_releases_lease_when_cancelled_before_body_starts():
    calls = []

    class Ledger:
        async def release(self, lease):
            calls.append(lease)

    async def content():
        raise AssertionError("Body was not started")
        yield b""

    response = WritingResponse(content(), admission=Ledger(), lease_id="lease")

    async def send(_message):
        raise asyncio.CancelledError()

    async def receive():
        await asyncio.Event().wait()

    with pytest.raises(asyncio.CancelledError):
        await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)
    assert calls == ["lease"]

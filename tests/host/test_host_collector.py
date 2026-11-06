"""Read-only native collection and durable receipts use synthetic inputs only."""

import base64
import json
from pathlib import Path
from uuid import uuid4

import pytest

from studio.contracts.agent_workbench.native import NativeLease
from studio.host.receipts import ReceiptStore
from studio.host.session_collection.agent_sources import OPERATIONS, execute


def lease(operation="agent_sources.validate", payload=None):
    return NativeLease(
        job_id=uuid4(),
        lease_id=uuid4(),
        owner_user_id="owner-a",
        operation=operation,
        payload=payload or {},
        lease_expires_at="2026-11-02T12:00:00",
    )


def test_collector_reads_history_and_referenced_files_without_changing_sources(tmp_path):
    root = tmp_path / "native"
    root.mkdir()
    native = root / "rollout-fixture.jsonl"
    records = [
        {
            "type": "session_meta",
            "payload": {
                "id": "native-one",
                "cwd": "/fixture",
                "source": "cli",
                "originator": "codex_cli_rs",
            },
        },
        {
            "type": "response_item",
            "payload": {
                "id": "message-one",
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "read-only original"}],
            },
        },
    ]
    content = "".join(json.dumps(row) + "\n" for row in records).encode()
    native.write_bytes(content)
    payload = {"agent_id": "codex", "root": str(root)}
    location = execute("agent_sources.validate", payload)
    assert location == {"root": str(root), "endpoint": ""}
    locators = execute("agent_sources.discover", payload)["locators"]
    assert locators
    result = execute("agent_sources.watch", {**payload, "locator": locators[0]})["batch"]
    assert result["info"]["native_id"] == "native-one"
    assert any(row["text"] == "read-only original" for row in result["entries"])
    assert native.read_bytes() == content
    asset = root / "reference.bin"
    asset.write_bytes(b"owned-reference")
    result = execute("agent_sources.attachment", {**payload, "reference": str(asset)})
    assert base64.b64decode(result["content_base64"]) == b"owned-reference"
    outside = tmp_path / "outside.bin"
    outside.write_bytes(b"must-not-read")
    with pytest.raises((ValueError, OSError)):
        execute("agent_sources.attachment", {**payload, "reference": str(outside)})
    with pytest.raises(ValueError):
        execute("shell.execute", {"command": "anything"})
    with pytest.raises(ValueError):
        execute(
            "agent_sources.validate",
            {
                "agent_id": "opencode",
                "endpoint": "https://external.example",
            },
        )
    with pytest.raises(ValueError):
        execute("agent_sources.validate", {"agent_id": "codex", "root": str(Path.home())})


def test_receipts_replay_completed_results_without_executing_again(tmp_path):
    store = ReceiptStore(tmp_path / "receipts", readonly_operations=OPERATIONS)
    command = lease(payload={"agent_id": "codex", "root": "/fixture"})
    calls = []

    def action(operation, payload):
        calls.append((operation, payload))
        return {"checked": True}

    first = store.execute(command, action)
    restarted = ReceiptStore(store.root, readonly_operations=OPERATIONS)
    assert restarted.execute(command, action) == first
    assert len(calls) == 1
    assert len(list(restarted.pending())) == 1
    restarted.acknowledge(command)
    assert list(restarted.pending()) == []
    changed = command.model_copy(update={"owner_user_id": "different-owner"})
    with pytest.raises(ValueError, match="账号"):
        restarted.execute(changed, action)


def test_interrupted_or_uncertain_actions_are_never_automatically_reexecuted(tmp_path):
    store = ReceiptStore(tmp_path / "receipts")
    command = lease("agent_runtime.execute")
    calls = []

    def interrupted(_operation, _payload):
        calls.append("started")
        raise KeyboardInterrupt()

    with pytest.raises(KeyboardInterrupt):
        store.execute(command, interrupted)
    recovered = ReceiptStore(store.root)
    outcome = recovered.execute(command, interrupted)
    assert outcome.status == "unknown"
    assert len(calls) == 1
    assert recovered.execute(command, interrupted) == outcome
    assert len(calls) == 1
    changed_lease = command.model_copy(update={"lease_id": uuid4()})
    assert recovered.execute(changed_lease, interrupted).status == "unknown"
    assert len(calls) == 1


def test_unclassified_execution_error_is_unknown_not_retryable_failure(tmp_path):
    store = ReceiptStore(tmp_path / "receipts")
    command = lease("agent_runtime.execute")

    def uncertain(_operation, _payload):
        raise RuntimeError("unknown external outcome")

    assert store.execute(command, uncertain).status == "unknown"


def test_ended_follow_keeps_unacknowledged_content_without_resuming_it(tmp_path):
    from studio.host.session_collection.follow_journal import FollowJournal

    store = FollowJournal(tmp_path / "follow")
    command = lease("agent_sources.follow", {"source_id": "source", "source_revision": 0})
    frame = store.stage(
        command,
        locator="original.jsonl",
        expected={},
        batch={"entries": [{"text": "only unacknowledged copy"}]},
    )
    store.end(command)
    assert store.read(command)["pending"] == frame
    assert list(store.recover()) == []

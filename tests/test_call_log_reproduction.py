from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

import pytest

from app.llm.call_logs.reproduction import build_reproduction_bundle
from app.llm.models import LlmCallLog


def _log(**overrides: object) -> LlmCallLog:
    values: dict[str, object] = {
        "id": "log-reproduction-test",
        "workspace_id": "workspace-test",
        "call_source": "model_playground",
        "provider_kind": "openai",
        "model": "gpt-test",
        "trace_id": "trace-test",
        "request_payload": {
            "messages": [{"role": "user", "content": "请复现这个问题"}],
            "temperature": 0.2,
        },
        "response_payload": {"debug": "Authorization: Bearer sk-response-secret"},
        "prompt_tokens": 8,
        "completion_tokens": 4,
        "total_tokens": 12,
        "latency_ms": 250,
        "status": "failed",
        "error_message": "api_key=sk-error-secret",
        "created_at": datetime(2026, 8, 23, 1, 2, 3),
    }
    values.update(overrides)
    return LlmCallLog(**values)


def test_reproduction_bundle_redacts_secrets_and_unsafe_base_url() -> None:
    row = _log()

    bundle = build_reproduction_bundle(
        row,
        base_url="https://user:password@example.com:invalid/v1?api_key=secret",
    )

    assert bundle.filename == "model-repro-log-repr.zip"
    assert b"sk-response-secret" not in bundle.content
    assert b"sk-error-secret" not in bundle.content
    assert b"password" not in bundle.content
    with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
        request = json.loads(archive.read("request.json"))
        expected = json.loads(archive.read("expected-response.json"))
        assert request["base_url"] == "https://api.openai.com/v1"
        assert expected["error_message"] == "api_key=[REDACTED]"
        assert expected["response_payload"]["debug"] == ("Authorization: Bearer [REDACTED]")


def test_anthropic_reproduction_uses_provider_protocol() -> None:
    row = _log(
        provider_kind="anthropic",
        model="claude-test",
        request_payload={
            "system": "保持简洁",
            "messages": [{"role": "user", "content": "测试"}],
            "max_tokens": 256,
        },
    )

    bundle = build_reproduction_bundle(row, base_url="https://proxy.example/v1/")

    with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
        request = json.loads(archive.read("request.json"))
        assert request["base_url"] == "https://proxy.example/v1"
        assert request["endpoint"] == "/messages"
        assert request["body"]["system"] == "保持简洁"
        assert request["body"]["max_tokens"] == 256


@pytest.mark.parametrize(("mode", "count"), [("sync", 2), ("async", 4)])
def test_generated_runner_executes_batch_modes(tmp_path: Path, mode: str, count: int) -> None:
    bundle = build_reproduction_bundle(_log(status="succeeded"), base_url="")
    with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
        archive.extractall(tmp_path)
    (tmp_path / "sitecustomize.py").write_text(
        """
import urllib.request

class FakeResponse:
    status = 200
    headers = {"Content-Type": "application/json"}
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self, limit=-1):
        return b'{"id":"response-test","choices":[]}'[:limit]

urllib.request.urlopen = lambda request, timeout=0: FakeResponse()
""".strip(),
        encoding="utf-8",
    )
    env = {
        **os.environ,
        "PYTHONPATH": str(tmp_path),
        "REPRO_BASE_URL": "http://reproduction.test/v1",
    }
    result = subprocess.run(
        [
            sys.executable,
            "run_repro.py",
            "--mode",
            mode,
            "--count",
            str(count),
            "--concurrency",
            "2",
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    summaries = list(tmp_path.glob("results/*/summary.json"))
    assert len(summaries) == 1
    summary = json.loads(summaries[0].read_text())
    assert summary["mode"] == mode
    assert summary["count"] == count
    assert summary["successes"] == count
    assert summary["failures"] == 0

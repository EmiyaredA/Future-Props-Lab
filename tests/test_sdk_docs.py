"""Keep new module names and restricted entrypoints explicit in SDK reference docs."""

import json
from pathlib import Path

from scripts.generate_sdk_docs import LABELS, ROOT, auth_for, build

from app.main import app


def test_reference_labels_cover_every_sdk_resource():
    root = Path(__file__).resolve().parents[1]
    mapping = json.loads((root / "sdk/python/operations.json").read_text())
    assert {entry["resource"] for entry in mapping.values()} <= LABELS.keys()


def test_assistant_reference_documents_desktop_and_session_requirements():
    paths = [path for path in app.openapi()["paths"] if path.startswith("/v1/amadeus/")]
    assert paths
    for path in paths:
        description = auth_for(path)
        assert "仅桌面模式" in description
        assert "浏览器 Session" in description
        assert "不接受 Management API Key" in description


def test_local_codex_reference_names_session_and_admin_restrictions():
    paths = [
        path
        for path in app.openapi()["paths"]
        if path.startswith("/v1/tool-navigation/codex-source")
    ]
    assert paths
    for path in paths:
        description = auth_for(path)
        assert "平台管理员 Session" in description
        assert "不接受 Management API Key 或 Agent 通道" in description


def test_generated_pairing_reference_distinguishes_local_client_from_browser():
    mapping = json.loads((ROOT / "sdk/python/operations.json").read_text())
    document = build()[ROOT / "web/src/docs/articles/sdk/sdk-reference-desktop.md"]
    for verb, requirement in (("POST", "私有本地 Agent 通道"), ("GET", "浏览器 Session")):
        operation = mapping[f"{verb} /v1/desktop/agent/pairings"]
        section = document.split(f"## {operation['method']} ", 1)[1].split("\n## ", 1)[0]
        assert requirement in section
        assert "创建账号须同源" not in section

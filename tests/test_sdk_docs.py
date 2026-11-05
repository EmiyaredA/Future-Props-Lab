"""Keep new module names and restricted entrypoints explicit in SDK reference docs."""

import json
from pathlib import Path

from scripts.generate_sdk_docs import LABELS, ROOT, auth_for, build

from website_test_support import app


def test_reference_labels_cover_every_sdk_resource():
    root = Path(__file__).resolve().parents[1]
    mapping = json.loads((root / "sdk/python/operations.json").read_text())
    assert {entry["resource"] for entry in mapping.values()} <= LABELS.keys()


def test_assistant_reference_documents_browser_session_requirements():
    paths = [path for path in app.openapi()["paths"] if path.startswith("/v1/amadeus/")]
    assert paths
    for path in paths:
        description = auth_for(path)
        assert "浏览器 Session" in description
        assert "不接受 Management API Key" in description


def test_generated_automation_reference_documents_resource_links():
    mapping = json.loads((ROOT / "sdk/python/operations.json").read_text())
    document = build()[ROOT / "web/src/docs/articles/sdk/sdk-reference-automation.md"]
    assert "AutomationOpenOut" in document
    assert "POST /v1/automation/open" in mapping
    assert not any("/v1/desktop/" in path for path in mapping)

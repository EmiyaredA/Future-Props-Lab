"""Exact service ownership and request assertions, independent of live databases."""

import json
import time
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from fpl_deployment.contracts import document, generate, operation_owner
from fpl_runtime.catalog import SERVICES
from fpl_runtime.claims import Actor, issue_context, verify_context
from fpl_runtime.routing import Operation, RouteCatalog

ROOT = Path(__file__).resolve().parents[1]


def test_all_public_operations_and_tables_have_reviewable_owners():
    data = document(ROOT)
    assert len(SERVICES) == 23
    assert len(data["operations"]) > 590
    assert len(data["tables"]) > 100
    assert (
        next(o["service"] for o in data["operations"] if o["path"] == "/v1/auth/login")
        == "identity"
    )
    assert (
        next(o["service"] for o in data["operations"] if o["path"] == "/v1/agent-workbench/sources")
        == "agents"
    )
    generate(ROOT, check=True)
    assert data["partitions"]["platform_settings"]["prefixes"]["account_defaults:"] == "models"
    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    assert catalog.match("GET", "/v1/agent-workbench/sessions/owned").service == "agents"
    assert catalog.match("GET", "/v1/unregistered") is None


def test_routes_refuse_ambiguous_templates_and_contract_drift():
    with pytest.raises(ValueError, match="重复"):
        RouteCatalog(
            [
                Operation("assets", "GET", "/v1/files/{id}", "one"),
                Operation("assets", "GET", "/v1/files/{other}", "two"),
            ]
        )
    catalog = RouteCatalog([Operation("assets", "GET", "/v1/files", "files")])
    with pytest.raises(ValueError, match="不完整"):
        catalog.check_openapi({"paths": {}})


def test_identity_assertion_is_bound_to_service_method_path_and_signature():
    key = Ed25519PrivateKey.generate()
    actor = Actor("owner-a", "user", "session", ("studio:read",), session_id="session-a")
    options = dict(service="agents", method="GET", path="/v1/agent-workbench/sessions")
    token = issue_context(actor, **options, private_key=key, key_id="one")
    assert verify_context(token, **options, public_key=key.public_key()) == actor
    for change in [
        {"service": "remote"},
        {"method": "POST"},
        {"path": "/v1/agent-workbench/candidates"},
        {"public_key": Ed25519PrivateKey.generate().public_key()},
    ]:
        with pytest.raises(jwt.InvalidTokenError):
            verify_context(token, **{**options, "public_key": key.public_key(), **change})
    expired = issue_context(
        actor, **options, private_key=key, key_id="one", now=int(time.time()) - 60
    )
    with pytest.raises(jwt.ExpiredSignatureError):
        verify_context(expired, **options, public_key=key.public_key())


def test_native_authority_requires_browser_and_strict_actor_types():
    with pytest.raises(ValueError):
        Actor("owner-a", "admin", "management_api_key", ("studio:write",), local=True)
    with pytest.raises(ValueError):
        Actor("owner-a", "admin", "session", ("studio:read",), local="false")


def test_manifest_does_not_include_credentials_or_runtime_paths():
    content = json.dumps(document(ROOT))
    assert "fpm_" not in content
    assert "/Users/" not in content
    assert "secrets_key" not in content


@pytest.mark.parametrize(
    ("path", "service"),
    [
        ("/v1/account/demo-services/{service_id}/install", "models"),
        ("/v1/account/developer-documents", "portal"),
        ("/v1/account/project-certification/{kind}/{project_id}", "creative"),
        ("/v1/tool-navigation/codex-source", "agent-runtime"),
    ],
)
def test_account_and_host_capability_prefixes_preserve_business_ownership(path, service):
    assert operation_owner(path) == service

"""Exact service ownership and request assertions, independent of live databases."""

import json
import time
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from studio.contracts.gateway.catalog import SERVICES
from studio.contracts.gateway.routing import Operation, RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context, verify_context
from studio.deployment.contracts import document, generate, operation_owner

ROOT = Path(__file__).resolve().parents[1]


def test_all_public_operations_and_tables_have_reviewable_owners():
    data = document(ROOT)
    assert len(SERVICES) == 23
    assert len(data["operations"]) > 590
    assert len(data["tables"]) > 100
    assert any(
        t["table"] == "creative_install_operations" and t["service"] == "creative"
        for t in data["tables"]
    )
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


def test_cloud_control_capabilities_keep_their_registered_owners():
    from studio.config import FIELDS

    data = document(ROOT)
    paths = {item["path"]: item["service"] for item in data["operations"]}
    assert paths["/v1/cloud-control/unlock"] == "identity"
    assert paths["/v1/cloud-control/desktop/connect"] == "remote"
    assert paths["/v1/agent-workbench/chats/{chat_id}/events"] == "agents"
    assert paths["/v1/code-agents/{agent_id}/enable"] == "agent-runtime"
    assert "/v1/code-agents/grants" not in paths
    tables = {item["table"]: item["service"] for item in data["tables"]}
    assert tables["cloud_control_factors"] == tables["cloud_control_unlocks"] == "identity"
    assert tables["cloud_desktop_preferences"] == "remote"
    assert tables["workbench_chats"] == tables["workbench_turns"] == "agents"
    assert {"path": "/cloud-control", "service": "portal"} in data["pages"]
    assert not any(page["path"] == "/remote" for page in data["pages"])
    assert {name: set(fields) for name, fields in data["configuration"].items()} == {
        name: set(fields) for name, fields in FIELDS.items()
    }
    assert data["configuration"]["cloud_control"]["projects"] == "agents"
    assert data["configuration"]["cloud_control"]["admin_user_ids"] == "identity"


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
    assert document(ROOT)["configuration"]["security"] == {"secrets_key": "per-service"}


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


def test_websocket_ownership_is_explicit_and_never_a_fake_http_operation():
    from studio.contracts.gateway.routing import SOCKET_OPERATIONS, SocketOperation

    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    socket = catalog.match_socket("/v1/model-test/realtime")
    assert socket == SocketOperation("models", "/v1/model-test/realtime", "models.use")
    assert catalog.match_socket("/v1/cloud-control/desktop/socket") == SocketOperation(
        "remote", "/v1/cloud-control/desktop/socket", "cloud-control.access"
    )
    assert tuple(catalog.websockets) == SOCKET_OPERATIONS
    assert catalog.match("GET", socket.path) is None
    assert catalog.match_socket(socket.path + "/unknown") is None
    with pytest.raises(ValueError, match="WebSocket"):
        RouteCatalog([], websockets=[socket, socket])
    with pytest.raises(ValueError, match="WebSocket"):
        RouteCatalog([Operation("models", "GET", socket.path, "not-a-socket")], websockets=[socket])
    schema = json.loads((ROOT / "web/src/generated/openapi.json").read_text())
    assert socket.path not in schema["paths"]


def test_gateway_sends_creative_posts_through_the_private_socket_after_authorization():
    from studio.deployment.gateway import render_gateway

    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    rendered = render_gateway(
        catalog,
        gateway_token="g" * 48,
        local_origin="http://127.0.0.1:19000",
        public_origin="https://studio.example.test",
        creative_ingress="i" * 48,
    )
    assert rendered.count("reverse_proxy unix//run/fpl-bridge/creative.sock") == 4
    assert rendered.count("rewrite * /_bridge/creative/source-import") == 2
    assert rendered.count("rewrite * /_bridge/creative/install") == 2
    for block in rendered.split("    handle @"):
        if "rewrite * /_bridge" in block:
            assert block.index("forward_auth identity:8080") < block.index("rewrite *")
            assert "header_up -Cookie" in block
            assert "header_up -Authorization" in block
            assert "header_up X-Fpl-Bridge-Ingress" in block
    assert "/_bridge /_bridge/*" in rendered


def test_gateway_matches_real_socket_upgrade_and_strips_forged_protocol_headers():
    from studio.deployment.gateway import render_gateway

    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    options = dict(
        gateway_token="g" * 48,
        local_origin="http://127.0.0.1:19000",
        public_origin="https://studio.example.test",
    )
    rendered = render_gateway(catalog, **options)
    for ingress in ("local", "public"):
        matcher = "@" + ingress + "_socket_0"
        assert (
            matcher
            + " {\n      method GET\n      path /v1/model-test/realtime"
            + "\n      header Upgrade websocket"
            in rendered
        )
    assert rendered.count("request_header X-Fpl-Request-Protocol websocket") == 4
    assert rendered.count("header_up -Upgrade") == 4
    assert rendered.count("header_up -Connection") == 4
    assert rendered.count("header_up -Sec-WebSocket-*") == 4
    assert "request_header X-Fpl-Request-Protocol http" not in rendered
    assert rendered.index("request_header -X-Fpl-*") < rendered.index(
        "request_header X-Fpl-Request-Protocol websocket"
    )
    management = render_gateway(catalog, **options, audience="management")
    assert "_socket_" not in management
    assert "/v1/model-test/realtime" not in management


def test_socket_contract_change_invalidates_only_its_own_program():
    from studio.contracts.gateway.protocol_hash import public_contract
    from studio.contracts.gateway.routing import SocketOperation

    schema = {"paths": {}, "components": {"schemas": {}}}
    plain = RouteCatalog([])
    sockets = RouteCatalog(
        [], websockets=[SocketOperation("models", "/v1/model-test/realtime", "models.use")]
    )
    assert public_contract(schema, "models", plain) != public_contract(schema, "models", sockets)
    assert public_contract(schema, "agents", plain) == public_contract(schema, "agents", sockets)


def test_every_cross_service_http_operation_has_an_identity_permission_policy():
    from studio.contracts.identity.route_permissions import route_permission

    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    missing = [
        (operation.method, operation.path)
        for operation in catalog.operations
        if operation.service != "identity"
        and route_permission(operation.method, operation.path) is None
    ]
    assert missing == []
    assert (
        route_permission("POST", "/v1/account/demo-services/mock_model/install")
        == "configuration.manage"
    )
    assert (
        route_permission("PATCH", "/v1/account/project-certification/visual/owned")
        == "projects.certify"
    )


def test_integrations_native_lane_is_loopback_only_and_strips_identity_headers():
    from studio.deployment.gateway import render_gateway

    rendered = render_gateway(
        RouteCatalog.read(ROOT / "deploy/contracts/ownership.json"),
        gateway_token="g" * 48,
        local_origin="http://127.0.0.1:19000",
        public_origin="https://studio.example.test",
        native_tokens={"integrations": "i" * 48},
    )
    native = rendered.split("http://:29090 {", 1)[1]
    assert '@host expression {http.request.hostport} != "127.0.0.1:29090"' in native
    assert "@browser header Origin *" in native
    assert "request_header -X-Fpl-*" in native
    assert "request_header -Cookie" in native
    assert "handle /integrations/_native/*" in native
    assert "uri strip_prefix /integrations" in native
    assert 'request_header X-Fpl-Native-Ingress "' + "i" * 48 + '"' in native
    assert "reverse_proxy integrations:8080" in native

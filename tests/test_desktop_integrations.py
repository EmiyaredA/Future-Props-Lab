"""Integration workflows through the real isolated desktop gateway."""

import io
import zipfile

import pytest
from tests import test_desktop_agent as agent_tests

from app.console.schemas.desktop_agent import DesktopOpenIn

pytestmark = pytest.mark.real_auth


@pytest.fixture
def connected(tmp_path):
    yield from agent_tests.connected.__wrapped__(tmp_path)


def archive(name="desktop-skill", description="测试文档"):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as package:
        package.writestr("SKILL.md", f"---\nname: {name}\ndescription: {description}\n---\n内容\n")
        package.writestr("references/read.md", "reference")
    return output.getvalue()


def test_skill_workflow_and_navigation(connected):
    from future_props_lab import ApiError, desktop_client

    backend, data = connected
    agent_tests.approve(backend, data)
    with desktop_client(data_dir=data) as sdk:
        capabilities = sdk._call("GET", "/v1/desktop/agent/capabilities")
        assert "integrations.create_skill" in capabilities["operations"]
        payload = archive()
        skill = sdk.integrations.create_skill(
            body={"enabled": True, "tags": ["飞书", "文档"]},
            files={"file": ("skill.zip", payload, "application/zip")},
        )
        assert skill.tags == ["飞书", "文档"] and skill.enabled
        assert sdk.integrations.skill(skill_id=skill.id).name == "desktop-skill"
        markdown = sdk.integrations.skill_version_markdown(skill_id=skill.id, version="v1")
        assert "测试文档" in markdown.content
        agent_tests.approve(backend, data, write=False, profile="skill-reader")
        with desktop_client(data_dir=data, profile="skill-reader") as reader:
            assert (
                reader.integrations.skill_version_markdown(skill_id=skill.id, version="v1").content
                == markdown.content
            )
        with sdk.integrations.skill_version_content(skill_id=skill.id, version="v1") as result:
            downloaded = b"".join(result.iter_bytes())
        with zipfile.ZipFile(io.BytesIO(downloaded)) as package:
            with zipfile.ZipFile(io.BytesIO(payload)) as original:
                assert {n: package.read(n) for n in package.namelist()} == {
                    n: original.read(n) for n in original.namelist()
                }
        skill = sdk.integrations.add_skill_version(
            skill_id=skill.id,
            body={"expected_revision": skill.revision},
            files={"file": ("skill.zip", archive(description="新版本"), "application/zip")},
        )
        assert skill.latest_version == "v2" and skill.default_version == "v1"
        assert skill.tags == ["飞书", "文档"]
        stale = skill.revision
        skill = sdk.integrations.update_skill(
            skill_id=skill.id,
            body={
                "expected_revision": stale,
                "enabled": False,
                "default_version": "v2",
                "tags": ["归档"],
            },
        )
        assert not skill.enabled and skill.default_version == "v2"
        with pytest.raises(ApiError) as conflict:
            sdk.integrations.update_skill(
                skill_id=skill.id,
                body={"expected_revision": stale, "enabled": True, "default_version": "v2"},
            )
        assert conflict.value.status == 409
        inbox = backend.client.get("/v1/desktop/ui/inbox").json()
        assert inbox["integration_revisions"]["skills"] >= 3
        assert inbox["content_change_revision"] == 0
        opened = sdk.desktop.open_in_app(
            body={"kind": "skill", "resource_id": skill.id, "view": "versions"}
        )
        assert opened.status == "pending"
        assert (
            backend.client.post(
                f"/v1/desktop/ui/requests/{opened.id}/ack", json={"status": "opened"}
            ).status_code
            == 200
        )
        assert sdk.desktop.open_status(request_id=opened.id).status == "opened"
        sdk.integrations.delete_skill(skill_id=skill.id, expected_revision=skill.revision)
        with pytest.raises(ApiError) as missing:
            sdk.desktop.open_in_app(body={"kind": "skill", "resource_id": skill.id})
        assert missing.value.status == 404
        with pytest.raises(ApiError) as invalid:
            sdk.integrations.create_skill(
                body={}, files={"file": ("bad.zip", b"not a zip", "application/zip")}
            )
        assert invalid.value.status == 422


def test_tool_and_mcp_management_and_readonly_denials(connected):
    from future_props_lab import ApiError, desktop_client

    backend, data = connected
    agent_tests.approve(backend, data)
    with desktop_client(data_dir=data) as sdk:
        tool_body = {
            "name": "example",
            "url": "http://127.0.0.1:1/test",
            "auth_kind": "bearer",
            "secret": "test-private-token",
        }
        tool = sdk.integrations.create_tool_api(body=tool_body)
        assert "test-private-token" not in tool.model_dump_json()
        assert sdk.integrations.tool_api(integration_id=tool.id).has_secret
        result = sdk.integrations.validate_tool_api(integration_id=tool.id, body={"input": {}})
        assert not result.check.ok  # connection refused is a structured validation outcome
        tool = sdk.integrations.update_tool_api(
            integration_id=tool.id,
            body={**tool_body, "secret": "", "expected_revision": tool.revision, "enabled": False},
        )
        assert not tool.enabled and tool.has_secret
        mcp_body = {"name": "stdio", "transport": "stdio", "command": "/not-allowed/mcp"}
        mcp = sdk.integrations.create_mcp(body=mcp_body)
        result = sdk.integrations.validate_mcp(integration_id=mcp.id)
        assert not result.check.ok
        assert sdk.integrations.mcp_tools(integration_id=mcp.id) == []
        mcp = sdk.integrations.update_mcp(
            integration_id=mcp.id,
            body={**mcp_body, "expected_revision": mcp.revision, "enabled": False},
        )
        backend.client.get("/v1/desktop/ui/inbox")
        for kind, view in [("skill", "upload"), ("tool-api", "edit"), ("mcp", "edit")]:
            assert sdk.desktop.open_in_app(body={"kind": kind, "view": view}).status == "pending"
        sdk.integrations.delete_mcp(integration_id=mcp.id, expected_revision=mcp.revision)
        sdk.integrations.delete_tool_api(integration_id=tool.id, expected_revision=tool.revision)
    agent_tests.approve(backend, data, write=False, profile="reader")
    with desktop_client(data_dir=data, profile="reader") as sdk:
        assert sdk.integrations.skills().items == []
        for action in [
            lambda: sdk.integrations.create_tool_api(body=tool_body),
            lambda: sdk.integrations.create_mcp(body=mcp_body),
            lambda: sdk.integrations.create_skill(
                body={}, files={"file": ("skill.zip", archive(), "application/zip")}
            ),
            lambda: sdk.desktop.open_in_app(body={"kind": "skill", "view": "upload"}),
        ]:
            with pytest.raises(ApiError) as denied:
                action()
            assert denied.value.status == 403
        assert sdk.desktop.open_in_app(body={"kind": "skill"}).status == "pending"


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "visual"},
        {"kind": "skill", "view": "edit"},
        {"kind": "skill", "view": "versions"},
        {"kind": "mcp", "view": "upload"},
        {"kind": "tool-api", "view": "list", "resource_id": "x"},
        {"kind": "skill", "resource_id": "../other"},
    ],
)
def test_open_targets_are_explicit(body):
    with pytest.raises(ValueError):
        DesktopOpenIn.model_validate(body)


def test_integration_ids_do_not_cross_workspaces(connected):
    from future_props_lab import ApiError, desktop_client

    backend, data = connected
    principal = agent_tests.approve(backend, data)
    other = backend.client.post(
        "/v1/platform/workspaces",
        json={"name": "Other integrations", "owner_user_id": principal["user_id"]},
    ).json()["id"]
    assert (
        backend.client.post(
            "/v1/account/workspaces/switch", json={"workspace_id": other}
        ).status_code
        == 200
    )
    bodies = {
        "tool-apis": {"name": "Private tool", "url": "http://127.0.0.1/tool"},
        "mcp": {"name": "Private MCP", "transport": "stdio", "command": "/no/command"},
    }
    with desktop_client(data_dir=data) as sdk:
        for kind, body in bodies.items():
            created = backend.client.post(f"/v1/integrations/{kind}", json=body).json()
            path = f"/v1/integrations/{kind}/{created['id']}"
            for method, suffix, payload in [
                ("GET", "", None),
                ("PATCH", "", {**body, "expected_revision": created["revision"]}),
                ("POST", "/validate", {"input": {}} if kind == "tool-apis" else None),
                ("DELETE", "", None),
                *(([("GET", "/tools", None)]) if kind == "mcp" else []),
            ]:
                with pytest.raises(ApiError) as missing:
                    sdk._call(
                        method,
                        path + suffix,
                        body=payload,
                        media_type="application/json",
                        parameters=[("expected_revision", "query", created["revision"])]
                        if method == "DELETE"
                        else [],
                    )
                assert missing.value.status == 404
            with pytest.raises(ApiError) as missing:
                sdk.desktop.open_in_app(
                    body={
                        "kind": "tool-api" if kind == "tool-apis" else "mcp",
                        "resource_id": created["id"],
                    }
                )
            assert missing.value.status == 404
        assert sdk.integrations.tool_apis().items == []
        assert sdk.integrations.mcp_servers().items == []

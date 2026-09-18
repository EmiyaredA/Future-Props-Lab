from __future__ import annotations

import io
import shutil
import stat
import zipfile
from pathlib import Path

import httpx
import pytest
from fastapi import UploadFile
from sqlalchemy import delete

from app.capabilities.identity.principal import StudioPrincipal
from app.deps import SessionDep, require_studio_auth
from app.integrations.common import IntegrationValidationError
from app.integrations.mcp import McpCatalog
from app.integrations.mcp.client import (
    DiscoveredTool,
    DiscoveryResult,
    OfficialMcpDiscoveryClient,
)
from app.integrations.skills.archive import SkillArchiveStorage
from app.integrations.skills.catalog import SkillCatalog
from app.integrations.tool_apis import ToolApiCatalog
from app.main import app
from app.models import (
    IntegrationCheck,
    McpDiscoveredTool,
    McpIntegration,
    SkillIntegration,
    SkillVersion,
    ToolApiIntegration,
)
from app.orm import bind_workspace
from app.runtime.config import get_settings
from app.runtime.db import SessionLocal
from app.runtime.outbound_urls import require_safe_integration_http_url
from app.schemas.integrations import McpCreateIn, ToolApiCreateIn


async def _clear_integrations() -> None:
    async with SessionLocal() as session:
        for model in (
            IntegrationCheck,
            McpDiscoveredTool,
            SkillVersion,
            ToolApiIntegration,
            McpIntegration,
            SkillIntegration,
        ):
            await session.execute(delete(model))
        await session.commit()


def _skill_zip(
    *,
    name: str = "demo-skill",
    description: str = "A local test skill",
    wrapped: bool = False,
    unsafe: bool = False,
    symlink: bool = False,
) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        prefix = "bundle/" if wrapped else ""
        archive.writestr(
            f"{prefix}SKILL.md",
            f"---\nname: {name}\ndescription: {description}\n---\n# Test\n",
        )
        if unsafe:
            archive.writestr("../escape.txt", "no")
        if symlink:
            entry = zipfile.ZipInfo(f"{prefix}link")
            entry.create_system = 3
            entry.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(entry, "SKILL.md")
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_skill_download_after_runtime_directory_move(tmp_path, monkeypatch) -> None:
    await _clear_integrations()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/v1/integrations/skills",
            files={"file": ("skill.zip", _skill_zip(), "application/zip")},
        )
        assert response.status_code == 201
        skill_id = response.json()["id"]
    settings = get_settings()
    moved = settings.model_copy(
        update={"fpl_database_path": str(tmp_path / "moved/future-props.db")}
    )
    old_root = SkillArchiveStorage(settings, "default").final_path(skill_id, "v1")
    new_root = SkillArchiveStorage(moved, "default").final_path(skill_id, "v1")
    shutil.copytree(old_root, new_root)
    old_root.rename(old_root.with_name("offline-v1"))
    monkeypatch.setattr("app.integrations.skills.catalog.get_settings", lambda: moved)
    async with SessionLocal() as session:
        _, payload = await SkillCatalog(session, "default").version_zip(skill_id, "v1")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        assert "name: demo-skill" in archive.read("SKILL.md").decode()


@pytest.mark.asyncio
async def test_tool_api_crud_secret_redaction_cas_and_mock_validation() -> None:
    await _clear_integrations()
    seen: dict[str, str] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("authorization", "")
        return httpx.Response(
            200,
            json={
                "accepted": request.url.params.get("name"),
                "echo": "super-secret-value",
            },
        )

    async with SessionLocal() as session:
        bind_workspace(session, "default")
        catalog = ToolApiCatalog(session, "default", transport=httpx.MockTransport(handler))
        created = await catalog.create(
            ToolApiCreateIn(
                name="Local echo",
                method="GET",
                url="http://127.0.0.1/tool",
                auth_kind="bearer",
                secret="super-secret-value",
                parameters_schema={
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"],
                },
                query_template={"name": "{{name}}"},
            )
        )
        assert created.has_secret is True
        assert created.secret_hint == "alue"
        assert "super-secret" not in created.model_dump_json()

        result = await catalog.validate(created.id, {"name": "Ada"})
        assert result.check.ok is True
        assert '"accepted":"Ada"' in result.response_preview
        assert "super-secret-value" not in result.response_preview
        assert "[REDACTED]" in result.response_preview
        assert seen["authorization"] == "Bearer super-secret-value"

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        current = (await client.get("/v1/integrations/tool-apis")).json()["items"][0]
        assert "secret" not in current
        conflict = await client.patch(
            f"/v1/integrations/tool-apis/{current['id']}",
            json={
                "name": current["name"],
                "description": "",
                "method": "GET",
                "url": current["url"],
                "auth_kind": "bearer",
                "auth_header_name": "",
                "secret": "",
                "clear_secret": False,
                "parameters_schema": current["parameters_schema"],
                "query_template": current["query_template"],
                "body_template": None,
                "tags": [],
                "enabled": True,
                "expected_revision": 99,
            },
        )
        assert conflict.status_code == 409
        assert conflict.json()["code"] == "revision_conflict"
        assert conflict.json()["current"]["id"] == current["id"]
    await _clear_integrations()


@pytest.mark.asyncio
async def test_tool_api_validation_does_not_follow_redirects_and_limits_responses() -> None:
    await _clear_integrations()
    calls: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/redirect":
            return httpx.Response(302, headers={"location": "https://example.com/next"})
        if request.url.path == "/large":
            return httpx.Response(200, content=b"x" * (1024 * 1024 + 1))
        raise TimeoutError

    async with SessionLocal() as session:
        bind_workspace(session, "default")
        catalog = ToolApiCatalog(session, "default", transport=httpx.MockTransport(handler))
        for name, path, expected in (
            ("Redirect fixture", "redirect", "HTTP 302"),
            ("Large fixture", "large", "超过 1 MiB"),
            ("Timeout fixture", "timeout", "超时"),
        ):
            item = await catalog.create(ToolApiCreateIn(name=name, url=f"http://127.0.0.1/{path}"))
            result = await catalog.validate(item.id, {})
            assert result.check.ok is False
            assert expected in result.check.summary
        assert calls == ["/redirect", "/large", "/timeout"]
    await _clear_integrations()


@pytest.mark.asyncio
async def test_catalog_queries_are_workspace_scoped() -> None:
    await _clear_integrations()
    async with SessionLocal() as session:
        bind_workspace(session, "default")
        await ToolApiCatalog(session, "default").create(
            ToolApiCreateIn(name="Default only", url="https://example.com/tool")
        )
    async with SessionLocal() as session:
        catalog = await ToolApiCatalog(session, "another-workspace").catalog()
        assert catalog.items == []
        assert catalog.overview.primary_count == 0
        assert catalog.overview.recent == []
    await _clear_integrations()


@pytest.mark.asyncio
async def test_integration_outbound_urls_block_credentials_and_private_networks() -> None:
    with pytest.raises(ValueError, match="无凭证"):
        ToolApiCreateIn(name="Credential URL", url="https://user:pass@example.com/tool")
    with pytest.raises(ValueError, match="HTTPS"):
        ToolApiCreateIn(name="Plain remote URL", url="http://example.com/tool")
    with pytest.raises(ValueError, match="不允许的网络范围"):
        await require_safe_integration_http_url("https://10.0.0.8/tool")
    assert (
        await require_safe_integration_http_url("http://127.0.0.1/tool") == "http://127.0.0.1/tool"
    )


@pytest.mark.asyncio
async def test_member_can_view_but_cannot_manage_integrations() -> None:
    await _clear_integrations()

    async def member(session: SessionDep) -> StudioPrincipal:
        bind_workspace(session, "default")
        return StudioPrincipal(
            user_id="member",
            workspace_id="default",
            membership_id="membership",
            workspace_access="member",
            member_role="member",
            is_platform_admin=False,
            must_change_password=False,
            auth_kind="session",
            scopes=frozenset({"studio:read"}),
            session_id="session",
        )

    app.dependency_overrides[require_studio_auth] = member
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            assert (await client.get("/v1/integrations/tool-apis")).status_code == 200
            denied = await client.post(
                "/v1/integrations/tool-apis",
                json={"name": "Nope", "url": "https://example.com"},
            )
            assert denied.status_code == 403
            assert denied.json()["code"] == "workspace_owner_required"
    finally:
        app.dependency_overrides.pop(require_studio_auth, None)


class _FakeMcpClient:
    async def discover(self, **_kwargs) -> DiscoveryResult:
        return DiscoveryResult(
            server_name="fixture-server",
            server_version="2.0",
            protocol_version="2025-11-25",
            tools=(
                DiscoveredTool(
                    name="lookup",
                    description="Look up a fixture",
                    input_schema={"type": "object", "properties": {}},
                ),
            ),
        )


class _FailingMcpClient:
    async def discover(self, **kwargs) -> DiscoveryResult:
        raise RuntimeError(
            f"authentication failed for {kwargs['bearer_token']} "
            f"and {kwargs['environment'].get('PRIVATE_VALUE', '')}"
        )


@pytest.mark.asyncio
async def test_mcp_validation_replaces_discovery_snapshot() -> None:
    await _clear_integrations()
    async with SessionLocal() as session:
        bind_workspace(session, "default")
        catalog = McpCatalog(session, "default", client=_FakeMcpClient())
        created = await catalog.create(
            McpCreateIn(
                name="Fixture MCP",
                transport="streamable_http",
                url="http://127.0.0.1/mcp",
                bearer_token="hidden-token",
            )
        )
        assert created.has_bearer_token is True
        validated = await catalog.validate(created.id)
        assert validated.check.ok is True
        assert validated.server.server_name == "fixture-server"
        assert [tool.name for tool in validated.tools] == ["lookup"]
        assert "hidden-token" not in validated.model_dump_json()
    await _clear_integrations()


@pytest.mark.asyncio
async def test_mcp_failure_summaries_and_responses_do_not_leak_secrets() -> None:
    await _clear_integrations()
    async with SessionLocal() as session:
        bind_workspace(session, "default")
        catalog = McpCatalog(session, "default", client=_FailingMcpClient())
        created = await catalog.create(
            McpCreateIn(
                name="Failing MCP",
                transport="stdio",
                command="/bin/echo",
                environment={"PRIVATE_VALUE": "environment-secret"},
            )
        )
        assert created.environment_keys == ["PRIVATE_VALUE"]
        assert "environment-secret" not in created.model_dump_json()
        result = await catalog.validate(created.id)
        assert result.check.ok is False
        assert "environment-secret" not in result.check.summary
    assert "[REDACTED]" in result.check.summary
    await _clear_integrations()


def test_stdio_requires_absolute_allowlisted_executable(tmp_path: Path) -> None:
    executable = tmp_path / "mcp-fixture"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o700)
    settings = get_settings().model_copy(update={"fpl_mcp_stdio_allowed_commands": str(executable)})
    client = OfficialMcpDiscoveryClient(settings)
    assert client._stdio_command(str(executable)) == executable.resolve()
    with pytest.raises(ValueError, match="绝对路径"):
        client._stdio_command("mcp-fixture")
    with pytest.raises(ValueError, match="白名单"):
        client._stdio_command("/bin/echo")


@pytest.mark.asyncio
async def test_skill_archive_enforces_configured_size_and_file_limits() -> None:
    settings = get_settings().model_copy(
        update={
            "fpl_skill_archive_max_bytes": 32,
            "fpl_skill_expanded_max_bytes": 32,
            "fpl_skill_max_files": 1,
        }
    )
    storage = SkillArchiveStorage(settings, "archive-limit-fixture")
    with pytest.raises(IntegrationValidationError, match="10 MiB"):
        await storage.stage(UploadFile(file=io.BytesIO(_skill_zip()), filename="oversized.zip"))

    settings = settings.model_copy(update={"fpl_skill_archive_max_bytes": 1024 * 1024})
    storage = SkillArchiveStorage(settings, "archive-limit-fixture")
    with pytest.raises(IntegrationValidationError, match="50 MiB"):
        await storage.stage(UploadFile(file=io.BytesIO(_skill_zip()), filename="expanded.zip"))

    settings = settings.model_copy(update={"fpl_skill_expanded_max_bytes": 1024 * 1024})
    storage = SkillArchiveStorage(settings, "archive-limit-fixture")
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        archive.writestr("SKILL.md", "---\nname: x\ndescription: y\n---\n")
        archive.writestr("extra.txt", "x")
    with pytest.raises(IntegrationValidationError, match="1 到 500"):
        await storage.stage(UploadFile(file=io.BytesIO(payload.getvalue()), filename="many.zip"))


@pytest.mark.asyncio
async def test_skill_zip_versions_download_and_rejects_unsafe_members() -> None:
    await _clear_integrations()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created_response = await client.post(
            "/v1/integrations/skills",
            files={"file": ("skill.zip", _skill_zip(wrapped=True), "application/zip")},
            data={"enabled": "true"},
        )
        assert created_response.status_code == 201, created_response.text
        created = created_response.json()
        assert created["default_version"] == "v1"
        assert created["version_count"] == 1

        added_response = await client.post(
            f"/v1/integrations/skills/{created['id']}/versions",
            files={
                "file": (
                    "skill-v2.zip",
                    _skill_zip(description="Second immutable version"),
                    "application/zip",
                )
            },
            data={"expected_revision": str(created["revision"])},
        )
        assert added_response.status_code == 200, added_response.text
        added = added_response.json()
        assert added["latest_version"] == "v2"
        assert added["default_version"] == "v1"

        switched = await client.patch(
            f"/v1/integrations/skills/{created['id']}",
            json={
                "expected_revision": added["revision"],
                "enabled": True,
                "default_version": "v2",
            },
        )
        assert switched.status_code == 200
        assert switched.json()["default_version"] == "v2"
        download = await client.get(f"/v1/integrations/skills/{created['id']}/versions/v1/content")
        assert download.status_code == 200
        assert download.headers["content-type"] == "application/zip"

        for payload in (_skill_zip(unsafe=True), _skill_zip(symlink=True)):
            rejected = await client.post(
                "/v1/integrations/skills",
                files={"file": ("unsafe.zip", payload, "application/zip")},
                data={"enabled": "false"},
            )
            assert rejected.status_code == 422
            assert "不安全" in rejected.text

        deleted = await client.delete(
            f"/v1/integrations/skills/{created['id']}",
            params={"expected_revision": switched.json()["revision"]},
        )
        assert deleted.status_code == 200
    await _clear_integrations()

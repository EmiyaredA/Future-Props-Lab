"""Explicit workspace ownership and external validation reconciliation."""

import httpx
import pytest
from tests.test_integrations import _clear_integrations, _FakeMcpClient

from app.integrations.common import IntegrationNotFoundError
from app.integrations.mcp import McpCatalog
from app.integrations.schemas import McpCreateIn, McpUpdateIn, ToolApiCreateIn, ToolApiUpdateIn
from app.integrations.tool_apis import ToolApiCatalog
from studio.assembly.http_dependencies import SessionDep, require_studio_auth
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.revisions import RevisionConflictError
from website_test_support import SessionLocal, app


@pytest.mark.asyncio
async def test_identity_map_and_child_records_require_explicit_workspace():
    await _clear_integrations()
    async with SessionLocal() as session:
        mcp = McpCatalog(session, "test-user", client=_FakeMcpClient())
        row = await mcp.create(
            McpCreateIn(
                name="Owned MCP",
                transport="streamable_http",
                url="http://127.0.0.1/mcp",
            )
        )
        await mcp.validate(row.id)
        foreign = McpCatalog(session, "unrelated")
        for action in [foreign.get, foreign.tools, foreign.validate]:
            with pytest.raises(IntegrationNotFoundError):
                await action(row.id)
        catalog = await foreign.catalog()
        assert catalog.items == [] and catalog.overview.recent == []
        assert catalog.overview.tertiary_count == 0
        assert len(await mcp.tools(row.id)) == 1
    await _clear_integrations()


@pytest.mark.asyncio
@pytest.mark.parametrize("privileged", [False, True])
async def test_sensitive_validation_preview_requires_its_existing_permission(
    monkeypatch, privileged
):
    await _clear_integrations()
    async with SessionLocal() as session:
        item = await ToolApiCatalog(session, "test-user").create(
            ToolApiCreateIn(
                name="Sensitive fixture",
                url="http://127.0.0.1/tool",
                sensitive_result=True,
            )
        )

    async def reply(*_args):
        return 200, "application/json", '{"private":"fixture data"}'

    monkeypatch.setattr("app.integrations.tool_apis.catalog._invoke", reply)
    original = app.dependency_overrides.get(require_studio_auth)
    try:

        async def identity(_session: SessionDep) -> StudioPrincipal:
            from studio.runtime.database.ownership import bind_owner

            bind_owner(_session, "test-user")
            return StudioPrincipal(
                platform_role="admin" if privileged else "user",
                user_id="test-user",
                must_change_password=False,
                auth_kind="management_api_key",
                scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
            )

        app.dependency_overrides[require_studio_auth] = identity
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                f"/v1/integrations/tool-apis/{item.id}/validate", json={"input": {}}
            )
            assert response.status_code == 200
            assert response.json()["check"]["ok"]
            assert "fixture data" in response.json()["response_preview"]
    finally:
        if original:
            app.dependency_overrides[require_studio_auth] = original
        else:
            app.dependency_overrides.pop(require_studio_auth, None)
    await _clear_integrations()


@pytest.mark.asyncio
async def test_mcp_timeout_is_a_structured_failed_check():
    await _clear_integrations()

    class TimeoutMcp:
        async def discover(self, **_kwargs):
            raise TimeoutError

    async with SessionLocal() as session:
        catalog = McpCatalog(session, "test-user", client=TimeoutMcp())
        row = await catalog.create(
            McpCreateIn(name="Timeout MCP", transport="stdio", command="/fixture")
        )
        result = await catalog.validate(row.id)
        assert not result.check.ok and "超时" in result.check.summary
        assert result.tools == [] and result.server.status == "failed"
    await _clear_integrations()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["tool", "mcp"])
async def test_configuration_changed_during_validation_is_not_overwritten(kind):
    await _clear_integrations()
    async with SessionLocal() as session:
        if kind == "tool":
            body = ToolApiCreateIn(name="Concurrent tool", url="http://127.0.0.1/tool")

            async def handler(_request):
                async with SessionLocal() as writer:
                    values = body.model_dump()
                    values["description"] = "new config"
                    await ToolApiCatalog(writer, "test-user").update(
                        row.id,
                        ToolApiUpdateIn(
                            **values,
                            expected_revision=row.revision,
                        ),
                    )
                return httpx.Response(200, json={"ok": True})

            catalog = ToolApiCatalog(session, "test-user", transport=httpx.MockTransport(handler))
        else:
            body = McpCreateIn(name="Concurrent MCP", transport="stdio", command="/fixture")

            class ChangedMcp(_FakeMcpClient):
                async def discover(self, **kwargs):
                    async with SessionLocal() as writer:
                        values = body.model_dump()
                        values["description"] = "new config"
                        await McpCatalog(writer, "test-user").update(
                            row.id,
                            McpUpdateIn(
                                **values,
                                expected_revision=row.revision,
                            ),
                        )
                    return await super().discover(**kwargs)

            catalog = McpCatalog(session, "test-user", client=ChangedMcp())
        row = await catalog.create(body)
        with pytest.raises(RevisionConflictError):
            if kind == "tool":
                await catalog.validate(row.id, {})
            else:
                await catalog.validate(row.id)
        current = await catalog.get(row.id)
        assert current.description == "new config" and current.status == "unchecked"
        assert (await catalog.catalog()).overview.recent == []
    await _clear_integrations()

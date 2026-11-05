from __future__ import annotations

import asyncio
import json
from time import monotonic

from jsonschema import validate as validate_json
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.integrations.storage.check_history import list_recent_checks, record_check
from studio.apps.integrations.storage.models import (
    IntegrationCheck,
    McpDiscoveredTool,
    McpIntegration,
)
from studio.contracts.integrations.catalog import (
    IntegrationOverviewOut,
    McpCatalogOut,
    McpCreateIn,
    McpOut,
    McpToolOut,
    McpUpdateIn,
    McpValidationOut,
)
from studio.contracts.integrations.errors import DuplicateIntegrationError, IntegrationNotFoundError
from studio.contracts.integrations.mcp import McpDiscoveryClient
from studio.runtime.database.ownership import require_owner_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.secrets import redact_sensitive, redact_structure
from studio.runtime.time import iso_utc, utc_now


def _tool_out(row: McpDiscoveredTool) -> McpToolOut:
    return McpToolOut(
        id=row.id,
        name=row.name,
        description=row.description,
        input_schema=dict(row.input_schema or {}),
    )


class McpCatalog:
    def __init__(
        self,
        session: AsyncSession,
        owner_user_id: str,
        *,
        client: McpDiscoveryClient,
        execution=None,
        cipher,
    ) -> None:
        self.cipher = cipher
        self.execution = execution
        self.session = session
        self.owner_user_id = require_owner_id(owner_user_id, subject="integration catalog")
        self.client = client

    async def _get(self, integration_id: str) -> McpIntegration:
        row = await self.session.get(McpIntegration, integration_id)
        if row is None or row.owner_user_id != self.owner_user_id:
            raise IntegrationNotFoundError("MCP 服务不存在")
        return row

    async def _tool_count(self, server_id: str) -> int:
        return int(
            (
                await self.session.execute(
                    select(func.count(McpDiscoveredTool.id)).where(
                        McpDiscoveredTool.server_id == server_id
                    )
                )
            ).scalar_one()
        )

    async def _out(self, row: McpIntegration) -> McpOut:
        return McpOut(
            id=row.id,
            name=row.name,
            description=row.description,
            transport=row.transport,
            url=row.url,
            command=row.command,
            arguments=list(row.arguments or []),
            has_bearer_token=bool(row.bearer_ciphertext),
            bearer_hint=self.cipher.hint(row.bearer_ciphertext),
            environment_keys=list(row.environment_keys or []),
            tags=list(row.tags or []),
            enabled=row.enabled,
            sensitive_result=row.sensitive_result,
            status=row.status,
            status_message="敏感服务详情已隐藏"
            if row.sensitive_result and row.status_message
            else row.status_message,
            server_name=row.server_name,
            server_version=row.server_version,
            protocol_version=row.protocol_version,
            tool_count=await self._tool_count(row.id),
            last_checked_at=iso_utc(row.last_checked_at) if row.last_checked_at else None,
            revision=row.revision,
            created_at=iso_utc(row.created_at),
            updated_at=iso_utc(row.updated_at),
        )

    async def get(self, integration_id: str) -> McpOut:
        return await self._out(await self._get(integration_id))

    async def execute(
        self, integration_id: str, tool_name: str, inputs: dict[str, object], expected_revision: int
    ) -> dict:
        row = await self._get(integration_id)
        snapshot = await self._out(row)
        if not snapshot.enabled or snapshot.revision != expected_revision:
            raise ValueError("MCP 已停用或配置已变更")
        tool = await self.session.scalar(
            select(McpDiscoveredTool).where(
                McpDiscoveredTool.server_id == integration_id,
                McpDiscoveredTool.name == tool_name,
            )
        )
        if tool is None:
            raise ValueError("MCP 工具尚未发现或已移除")
        validate_json(instance=inputs, schema=tool.input_schema or {"type": "object"})
        bearer_ciphertext, environment_ciphertext = (
            row.bearer_ciphertext,
            row.environment_ciphertext,
        )
        await self.session.rollback()
        if self.execution is not None:
            await self.execution.live()
        bearer = self.cipher.decrypt(bearer_ciphertext) if bearer_ciphertext else ""
        environment = (
            json.loads(self.cipher.decrypt(environment_ciphertext))
            if environment_ciphertext
            else {}
        )
        result = await asyncio.wait_for(
            self.client.call(
                transport=snapshot.transport,
                url=snapshot.url,
                command=snapshot.command,
                arguments=snapshot.arguments,
                bearer_token=bearer,
                environment=environment,
                tool_name=tool_name,
                tool_arguments=inputs,
            ),
            timeout=30.0,
        )
        if len(json.dumps(result)) > 1024 * 1024:
            raise ValueError("MCP 响应超过 1 MiB")
        return {
            "result": "敏感结果已隐藏"
            if snapshot.sensitive_result
            else redact_structure(result, [bearer, *environment.values()])
        }

    async def tools(self, integration_id: str) -> list[McpToolOut]:
        await self._get(integration_id)
        rows = (
            (
                await self.session.execute(
                    select(McpDiscoveredTool)
                    .where(McpDiscoveredTool.server_id == integration_id)
                    .order_by(McpDiscoveredTool.name)
                )
            )
            .scalars()
            .all()
        )
        return [_tool_out(row) for row in rows]

    async def catalog(self) -> McpCatalogOut:
        rows = (
            (
                await self.session.execute(
                    select(McpIntegration)
                    .where(McpIntegration.owner_user_id == self.owner_user_id)
                    .order_by(McpIntegration.updated_at.desc(), McpIntegration.name)
                )
            )
            .scalars()
            .all()
        )
        server_ids = [row.id for row in rows]
        total_tools = (
            int(
                (
                    await self.session.execute(
                        select(func.count(McpDiscoveredTool.id)).where(
                            McpDiscoveredTool.server_id.in_(server_ids)
                        )
                    )
                ).scalar_one()
            )
            if server_ids
            else 0
        )
        return McpCatalogOut(
            items=[await self._out(row) for row in rows],
            overview=IntegrationOverviewOut(
                primary_count=sum(row.status == "healthy" for row in rows),
                failed_count=sum(row.status == "failed" for row in rows),
                tertiary_count=total_tools,
                recent=await list_recent_checks(self.session, self.owner_user_id, "mcp"),
            ),
        )

    def _encrypted_environment(self, environment: dict[str, str]) -> str:
        return (
            self.cipher.encrypt(json.dumps(environment, ensure_ascii=False)) if environment else ""
        )

    async def create(self, body: McpCreateIn) -> McpOut:
        row = McpIntegration(
            owner_user_id=self.owner_user_id,
            name=body.name,
            description=body.description,
            transport=body.transport,
            url=body.url,
            command=body.command,
            arguments=body.arguments,
            bearer_ciphertext=self.cipher.encrypt(body.bearer_token) if body.bearer_token else "",
            environment_ciphertext=self._encrypted_environment(body.environment),
            environment_keys=sorted(body.environment),
            tags=body.tags,
            enabled=body.enabled,
            sensitive_result=body.sensitive_result,
        )
        self.session.add(row)
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise DuplicateIntegrationError("MCP 服务名称已存在") from exc
        await self.session.refresh(row)
        return await self._out(row)

    async def update(self, integration_id: str, body: McpUpdateIn) -> McpOut:
        current = await self._get(integration_id)
        snapshot = await self._out(current)
        if current.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision, current.revision, snapshot.model_dump(mode="json")
            )
        bearer = current.bearer_ciphertext
        environment = current.environment_ciphertext
        environment_keys = current.environment_keys
        if body.clear_bearer_token:
            bearer = ""
        if body.bearer_token:
            bearer = self.cipher.encrypt(body.bearer_token)
        if body.clear_environment:
            environment = ""
            environment_keys = []
        if body.environment:
            environment = self._encrypted_environment(body.environment)
            environment_keys = sorted(body.environment)
        result = await self.session.execute(
            update(McpIntegration)
            .where(
                McpIntegration.owner_user_id == self.owner_user_id,
                McpIntegration.id == integration_id,
                McpIntegration.revision == body.expected_revision,
            )
            .values(
                name=body.name,
                description=body.description,
                transport=body.transport,
                url=body.url,
                command=body.command,
                arguments=body.arguments,
                bearer_ciphertext=bearer,
                environment_ciphertext=environment,
                environment_keys=environment_keys,
                tags=body.tags,
                enabled=body.enabled,
                sensitive_result=body.sensitive_result,
                status="unchecked",
                status_message="",
                server_name="",
                server_version="",
                protocol_version="",
                last_checked_at=None,
                revision=McpIntegration.revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            latest = await self._get(integration_id)
            latest_out = await self._out(latest)
            raise RevisionConflictError(
                body.expected_revision, latest.revision, latest_out.model_dump(mode="json")
            )
        await self.session.execute(
            delete(McpDiscoveredTool).where(McpDiscoveredTool.server_id == integration_id)
        )
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise DuplicateIntegrationError("MCP 服务名称已存在") from exc
        return await self.get(integration_id)

    async def delete(self, integration_id: str, expected_revision: int) -> None:
        current = await self._get(integration_id)
        snapshot = await self._out(current)
        if current.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision, current.revision, snapshot.model_dump(mode="json")
            )
        await self.session.execute(
            delete(IntegrationCheck).where(
                IntegrationCheck.owner_user_id == self.owner_user_id,
                IntegrationCheck.resource_kind == "mcp",
                IntegrationCheck.resource_id == integration_id,
            )
        )
        result = await self.session.execute(
            delete(McpIntegration).where(
                McpIntegration.owner_user_id == self.owner_user_id,
                McpIntegration.id == integration_id,
                McpIntegration.revision == expected_revision,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            latest = await self._get(integration_id)
            latest_out = await self._out(latest)
            raise RevisionConflictError(
                expected_revision, latest.revision, latest_out.model_dump(mode="json")
            )
        await self.session.commit()

    async def validate(self, integration_id: str) -> McpValidationOut:
        row = await self._get(integration_id)
        snapshot = await self._out(row)
        bearer_ciphertext = row.bearer_ciphertext
        environment_ciphertext = row.environment_ciphertext
        await self.session.rollback()
        started = monotonic()
        ok = False
        summary = ""
        discovery = None
        bearer = ""
        environment: dict[str, str] = {}
        try:
            bearer = self.cipher.decrypt(bearer_ciphertext) if bearer_ciphertext else ""
            environment = (
                json.loads(self.cipher.decrypt(environment_ciphertext))
                if environment_ciphertext
                else {}
            )

            async def invoke():
                return await asyncio.wait_for(
                    self.client.discover(
                        transport=snapshot.transport,
                        url=snapshot.url,
                        command=snapshot.command,
                        arguments=snapshot.arguments,
                        bearer_token=bearer,
                        environment=environment,
                    ),
                    timeout=30.0,
                )

            discovery = await (
                self.execution.run(snapshot, {}, invoke) if self.execution else invoke()
            )
            ok = True
            summary = f"连接成功，发现 {len(discovery.tools)} 个工具"
        except TimeoutError:
            summary = "验证超时（30 秒）"
        except Exception as exc:
            summary = (
                redact_sensitive(str(exc), [bearer, *environment.values()])[:500]
                or type(exc).__name__
            )
        latency_ms = int((monotonic() - started) * 1000)
        latest = await self._get(integration_id)
        if latest.revision != snapshot.revision:
            current = await self.get(integration_id)
            raise RevisionConflictError(
                snapshot.revision, latest.revision, current.model_dump(mode="json")
            )
        if latest.sensitive_result:
            summary = "敏感 MCP 连接验证完成" if ok else "敏感 MCP 连接验证失败，详情已隐藏"
        secrets = [bearer, *environment.values()]
        values = dict(
            status="healthy" if ok else "failed", status_message=summary, last_checked_at=utc_now()
        )
        if discovery is not None:
            values.update(
                server_name=redact_sensitive(discovery.server_name, secrets),
                server_version=redact_sensitive(discovery.server_version, secrets),
                protocol_version=redact_sensitive(discovery.protocol_version, secrets),
            )
        result = await self.session.execute(
            update(McpIntegration)
            .where(
                McpIntegration.owner_user_id == self.owner_user_id,
                McpIntegration.id == integration_id,
                McpIntegration.revision == snapshot.revision,
            )
            .values(**values)
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get(integration_id)
            raise RevisionConflictError(
                snapshot.revision, current.revision, current.model_dump(mode="json")
            )
        if discovery is not None:
            await self.session.execute(
                delete(McpDiscoveredTool).where(McpDiscoveredTool.server_id == integration_id)
            )
            self.session.add_all(
                [
                    McpDiscoveredTool(
                        server_id=integration_id,
                        name=redact_sensitive(tool.name, secrets),
                        description=redact_sensitive(tool.description, secrets),
                        input_schema=redact_structure(tool.input_schema, secrets),
                    )
                    for tool in discovery.tools
                ]
            )
        check = await record_check(
            self.session,
            owner_user_id=self.owner_user_id,
            kind="mcp",
            resource_id=integration_id,
            resource_name=latest.name,
            ok=ok,
            status_code=None,
            latency_ms=latency_ms,
            summary=summary,
        )
        await self.session.commit()
        return McpValidationOut(
            check=check,
            server=await self.get(integration_id),
            tools=await self.tools(integration_id),
        )

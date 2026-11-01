from __future__ import annotations

import asyncio
import json
import re
from time import monotonic
from typing import Any

import httpx
from jsonschema import SchemaError, ValidationError, validate
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.demo_runtime.runtime import TOOL_BASE_URL, tool_reply
from app.integrations.checks import list_recent_checks, record_check
from app.integrations.common import (
    DuplicateIntegrationError,
    IntegrationNotFoundError,
    redact_sensitive,
)
from app.integrations.models import IntegrationCheck, ToolApiIntegration
from app.integrations.schemas import (
    IntegrationOverviewOut,
    ToolApiCatalogOut,
    ToolApiCreateIn,
    ToolApiOut,
    ToolApiUpdateIn,
    ToolApiValidationOut,
)
from app.orm import require_owner_id
from app.runtime.credentials import decrypt_secret, encrypt_secret
from app.runtime.outbound_urls import require_safe_integration_http_url
from app.runtime.revisions import RevisionConflictError
from app.runtime.secret_hints import encrypted_secret_hint
from app.runtime.time import iso_utc, utc_now

PLACEHOLDER = re.compile(r"{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}")
RESPONSE_LIMIT = 1024 * 1024
PREVIEW_LIMIT = 32 * 1024


def _out(row: ToolApiIntegration) -> ToolApiOut:
    return ToolApiOut(
        id=row.id,
        name=row.name,
        description=row.description,
        method=row.method,
        url=row.url,
        auth_kind=row.auth_kind,
        auth_header_name=row.auth_header_name,
        has_secret=bool(row.secret_ciphertext),
        secret_hint=encrypted_secret_hint(row.secret_ciphertext),
        parameters_schema=dict(row.parameters_schema or {}),
        query_template=dict(row.query_template or {}),
        body_template=row.body_template,
        tags=list(row.tags or []),
        enabled=row.enabled,
        sensitive_result=row.sensitive_result,
        status=row.status,
        status_message="敏感服务详情已隐藏"
        if row.sensitive_result and row.status_message
        else row.status_message,
        last_checked_at=iso_utc(row.last_checked_at) if row.last_checked_at else None,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )


def _render(value: Any, inputs: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {key: _render(item, inputs) for key, item in value.items()}
    if isinstance(value, list):
        return [_render(item, inputs) for item in value]
    if not isinstance(value, str):
        return value
    exact = PLACEHOLDER.fullmatch(value)
    if exact:
        key = exact.group(1)
        if key not in inputs:
            raise ValueError(f"缺少输入字段：{key}")
        return inputs[key]

    def substitute(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in inputs:
            raise ValueError(f"缺少输入字段：{key}")
        item = inputs[key]
        if isinstance(item, (dict, list)):
            raise ValueError(f"字段 {key} 不能嵌入字符串")
        return str(item)

    rendered = PLACEHOLDER.sub(substitute, value)
    if "{{" in rendered or "}}" in rendered:
        raise ValueError("模板仅支持 {{field}} 占位符")
    return rendered


async def _invoke(
    snapshot: ToolApiOut,
    secret: str,
    inputs: dict[str, Any],
    transport: httpx.AsyncBaseTransport | None,
) -> tuple[int, str, str]:
    if snapshot.url.startswith(TOOL_BASE_URL + "/"):
        reply = await tool_reply(snapshot.url.rsplit("/", 1)[-1], inputs)
        return 200, "application/json", json.dumps(reply, ensure_ascii=False)
    url = await require_safe_integration_http_url(snapshot.url)
    params = _render(snapshot.query_template, inputs)
    body = _render(snapshot.body_template, inputs) if snapshot.body_template is not None else None
    headers: dict[str, str] = {"Accept": "application/json, text/plain;q=0.9, */*;q=0.1"}
    if snapshot.auth_kind == "bearer" and secret:
        headers["Authorization"] = f"Bearer {secret}"
    elif snapshot.auth_kind == "api_key" and secret:
        headers[snapshot.auth_header_name] = secret
    timeout = httpx.Timeout(30.0, connect=10.0)
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=False,
        transport=transport,
    ) as client:
        async with client.stream(
            snapshot.method,
            url,
            params=params,
            json=body,
            headers=headers,
        ) as response:
            content_type = response.headers.get("content-type", "").split(";", 1)[0]
            payload = bytearray()
            async for chunk in response.aiter_bytes():
                payload.extend(chunk)
                if len(payload) > RESPONSE_LIMIT:
                    raise ValueError("响应超过 1 MiB 限制")
            preview = bytes(payload[:PREVIEW_LIMIT]).decode("utf-8", errors="replace")
            return response.status_code, content_type, preview


class ToolApiCatalog:
    def __init__(
        self,
        session: AsyncSession,
        owner_user_id: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.session = session
        self.owner_user_id = require_owner_id(owner_user_id, subject="integration catalog")
        self.transport = transport

    async def _get(self, integration_id: str) -> ToolApiIntegration:
        row = await self.session.get(ToolApiIntegration, integration_id)
        if row is None or row.owner_user_id != self.owner_user_id:
            raise IntegrationNotFoundError("工具 API 不存在")
        return row

    async def get(self, integration_id: str) -> ToolApiOut:
        return _out(await self._get(integration_id))

    async def execute(
        self, integration_id: str, inputs: dict[str, Any], expected_revision: int
    ) -> dict[str, Any]:
        """Call one enabled Tool API without mutating its configuration/check history."""
        row = await self._get(integration_id)
        snapshot = _out(row)
        if not snapshot.enabled or snapshot.revision != expected_revision:
            raise ValueError("工具已停用或配置已变更")
        validate(instance=inputs, schema=snapshot.parameters_schema)
        secret = decrypt_secret(row.secret_ciphertext) if row.secret_ciphertext else ""
        await self.session.rollback()
        status_code, content_type, preview = await asyncio.wait_for(
            _invoke(snapshot, secret, inputs, self.transport), timeout=30.0
        )
        if not 200 <= status_code < 300:
            raise ValueError(f"远端返回 HTTP {status_code}")
        return {
            "status_code": status_code,
            "content_type": content_type,
            "text": "敏感结果已隐藏"
            if snapshot.sensitive_result
            else redact_sensitive(preview, [secret]),
        }

    async def catalog(self) -> ToolApiCatalogOut:
        rows = (
            (
                await self.session.execute(
                    select(ToolApiIntegration)
                    .where(ToolApiIntegration.owner_user_id == self.owner_user_id)
                    .order_by(ToolApiIntegration.updated_at.desc(), ToolApiIntegration.name)
                )
            )
            .scalars()
            .all()
        )
        today = utc_now().replace(hour=0, minute=0, second=0, microsecond=0)
        checks_today = int(
            (
                await self.session.execute(
                    select(func.count(IntegrationCheck.id)).where(
                        IntegrationCheck.owner_user_id == self.owner_user_id,
                        IntegrationCheck.resource_kind == "tool_api",
                        IntegrationCheck.created_at >= today,
                    )
                )
            ).scalar_one()
        )
        return ToolApiCatalogOut(
            items=[_out(row) for row in rows],
            overview=IntegrationOverviewOut(
                primary_count=sum(row.enabled for row in rows),
                failed_count=sum(row.status == "failed" for row in rows),
                tertiary_count=checks_today,
                recent=await list_recent_checks(self.session, self.owner_user_id, "tool_api"),
            ),
        )

    async def create(self, body: ToolApiCreateIn) -> ToolApiOut:
        row = ToolApiIntegration(
            owner_user_id=self.owner_user_id,
            name=body.name,
            description=body.description,
            method=body.method,
            url=body.url,
            auth_kind=body.auth_kind,
            auth_header_name=body.auth_header_name,
            secret_ciphertext=encrypt_secret(body.secret) if body.secret else "",
            parameters_schema=body.parameters_schema,
            query_template=body.query_template,
            body_template=body.body_template,
            tags=body.tags,
            enabled=body.enabled,
            sensitive_result=body.sensitive_result,
        )
        self.session.add(row)
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise DuplicateIntegrationError("工具 API 名称已存在") from exc
        await self.session.refresh(row)
        return _out(row)

    async def update(self, integration_id: str, body: ToolApiUpdateIn) -> ToolApiOut:
        current = await self._get(integration_id)
        if current.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision, current.revision, _out(current).model_dump(mode="json")
            )
        secret = current.secret_ciphertext
        if body.clear_secret:
            secret = ""
        if body.secret:
            secret = encrypt_secret(body.secret)
        result = await self.session.execute(
            update(ToolApiIntegration)
            .where(
                ToolApiIntegration.owner_user_id == self.owner_user_id,
                ToolApiIntegration.id == integration_id,
                ToolApiIntegration.revision == body.expected_revision,
            )
            .values(
                name=body.name,
                description=body.description,
                method=body.method,
                url=body.url,
                auth_kind=body.auth_kind,
                auth_header_name=body.auth_header_name,
                secret_ciphertext=secret,
                parameters_schema=body.parameters_schema,
                query_template=body.query_template,
                body_template=body.body_template,
                tags=body.tags,
                enabled=body.enabled,
                sensitive_result=body.sensitive_result,
                status="unchecked",
                status_message="",
                last_checked_at=None,
                revision=ToolApiIntegration.revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            latest = await self._get(integration_id)
            raise RevisionConflictError(
                body.expected_revision, latest.revision, _out(latest).model_dump(mode="json")
            )
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise DuplicateIntegrationError("工具 API 名称已存在") from exc
        return await self.get(integration_id)

    async def delete(self, integration_id: str, expected_revision: int) -> None:
        current = await self._get(integration_id)
        if current.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision, current.revision, _out(current).model_dump(mode="json")
            )
        await self.session.execute(
            delete(IntegrationCheck).where(
                IntegrationCheck.owner_user_id == self.owner_user_id,
                IntegrationCheck.resource_kind == "tool_api",
                IntegrationCheck.resource_id == integration_id,
            )
        )
        result = await self.session.execute(
            delete(ToolApiIntegration).where(
                ToolApiIntegration.owner_user_id == self.owner_user_id,
                ToolApiIntegration.id == integration_id,
                ToolApiIntegration.revision == expected_revision,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            latest = await self._get(integration_id)
            raise RevisionConflictError(
                expected_revision, latest.revision, _out(latest).model_dump(mode="json")
            )
        await self.session.commit()

    async def validate(self, integration_id: str, inputs: dict[str, Any]) -> ToolApiValidationOut:
        row = await self._get(integration_id)
        snapshot = _out(row)
        secret_ciphertext = row.secret_ciphertext
        await self.session.rollback()
        started = monotonic()
        preview = ""
        content_type = ""
        status_code: int | None = None
        ok = False
        summary = ""
        secret = ""
        try:
            secret = decrypt_secret(secret_ciphertext) if secret_ciphertext else ""
            validate(instance=inputs, schema=snapshot.parameters_schema)
            status_code, content_type, preview = await asyncio.wait_for(
                _invoke(snapshot, secret, inputs, self.transport),
                timeout=30.0,
            )
            preview = redact_sensitive(preview, [secret])
            ok = 200 <= status_code < 300
            summary = f"HTTP {status_code}" if ok else f"远端返回 HTTP {status_code}"
        except (SchemaError, ValidationError) as exc:
            summary = f"输入不符合 Schema：{exc.message}"[:500]
        except TimeoutError:
            summary = "验证超时（30 秒）"
        except (httpx.HTTPError, ValueError) as exc:
            summary = redact_sensitive(str(exc), [secret])[:500] or type(exc).__name__
        except Exception as exc:
            summary = redact_sensitive(str(exc), [secret])[:500] or type(exc).__name__
        if snapshot.sensitive_result:
            summary = "敏感工具验证完成" if ok else "敏感工具验证失败，详情已隐藏"
        latency_ms = int((monotonic() - started) * 1000)
        latest = await self._get(integration_id)
        if latest.revision != snapshot.revision:
            current = await self.get(integration_id)
            raise RevisionConflictError(
                snapshot.revision, latest.revision, current.model_dump(mode="json")
            )
        result = await self.session.execute(
            update(ToolApiIntegration)
            .where(
                ToolApiIntegration.owner_user_id == self.owner_user_id,
                ToolApiIntegration.id == integration_id,
                ToolApiIntegration.revision == snapshot.revision,
            )
            .values(
                status="healthy" if ok else "failed",
                status_message=summary,
                last_checked_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get(integration_id)
            raise RevisionConflictError(
                snapshot.revision, current.revision, current.model_dump(mode="json")
            )
        check = await record_check(
            self.session,
            owner_user_id=self.owner_user_id,
            kind="tool_api",
            resource_id=integration_id,
            resource_name=latest.name,
            ok=ok,
            status_code=status_code,
            latency_ms=latency_ms,
            summary=summary,
        )
        await self.session.commit()
        return ToolApiValidationOut(
            check=check,
            response_preview=preview,
            content_type=content_type,
        )

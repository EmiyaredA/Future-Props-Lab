"""Prepare inert audit receipts before mutation; JWT proof is used only in flight."""

from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

import httpx

from app.runtime.operation_receipts import OperationError
from studio.contracts.model_service.model_audit import (
    AuditSource,
    ModelAuditReceipt,
    ModelAuditRecord,
    PreparedModelAudit,
)
from studio.runtime.time import utc_now


@dataclass(frozen=True)
class PreparedChange:
    receipt: PreparedModelAudit
    event_type: str
    detail: dict
    created_at: datetime


class ModelAuditClient:
    def __init__(self, *, credential, base_url="http://identity:8080", transport=None):
        self.client = httpx.AsyncClient(
            base_url=base_url,
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            timeout=5,
            headers={"Authorization": "Bearer " + credential},
        )

    async def exchange(self, path, body, response_type, *, fingerprint=None):
        try:
            async with self.client.stream(
                "POST", "/_internal/v1/model-audit/" + path, json=body.model_dump(mode="json")
            ) as response:
                response.raise_for_status()
                if response.status_code != 200:
                    raise ValueError("audit response status")
                data = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=16384):
                    data.extend(chunk)
                    if len(data) > 32768:
                        raise ValueError("audit response size")
            value = response_type.model_validate_json(data)
            if value.id != body.id or value.fingerprint != (
                fingerprint if fingerprint is not None else body.fingerprint()
            ):
                raise ValueError("audit response mismatch")
            return value
        except (httpx.HTTPError, ValueError, TypeError):
            raise OperationError(
                "治理审计暂不可用，原操作未获新的执行权", "model_audit_unavailable", 503
            ) from None

    async def prepare(self, request, event_type, detail):
        record = ModelAuditRecord(
            id=uuid4(),
            event_type=event_type,
            detail=detail,
            created_at=utc_now(),
            source=AuditSource(
                method=request.method,
                path=request.url.path,
                assertion=request.state.service_assertion,
            ),
        )
        receipt = await self.exchange("prepare", record, PreparedModelAudit)
        return PreparedChange(receipt, event_type, dict(detail), record.created_at)

    async def prepare_child(self, body):
        return await self.exchange("prepare-child", body, PreparedModelAudit)

    async def commit(self, body):
        return await self.exchange("commit", body, ModelAuditReceipt, fingerprint=body.fingerprint)

    async def close(self):
        await self.client.aclose()

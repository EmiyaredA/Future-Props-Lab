"""Receipt and CAS primitives; callers own transactions, snapshots and business rules."""

import hashlib
import json

from studio.runtime.database.project_operations import ProjectOperationReceipt
from studio.runtime.operation_errors import OperationError as OperationError


def fingerprint(body):
    content = body.model_dump(mode="json", by_alias=True)
    return hashlib.sha256(
        json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


async def replay(session, *, owner_user_id, kind, resource_id, body):
    row = await session.get(
        ProjectOperationReceipt, (owner_user_id, kind, resource_id, body.request_id)
    )
    if row is None:
        return None
    if row.fingerprint != fingerprint(body):
        raise OperationError("同一 request_id 不能用于不同操作", "idempotency_conflict", 409)
    return row.result


def record(session, *, owner_user_id, kind, resource_id, body, result):
    session.add(
        ProjectOperationReceipt(
            owner_user_id=owner_user_id,
            resource_kind=kind,
            resource_id=resource_id,
            request_id=body.request_id,
            fingerprint=fingerprint(body),
            result=result.model_dump(mode="json", by_alias=True),
        )
    )


async def forget(session, *, owner_user_id, kind, resource_id):
    from sqlalchemy import delete

    await session.execute(
        delete(ProjectOperationReceipt).where(
            ProjectOperationReceipt.owner_user_id == owner_user_id,
            ProjectOperationReceipt.resource_kind == kind,
            ProjectOperationReceipt.resource_id == resource_id,
        )
    )

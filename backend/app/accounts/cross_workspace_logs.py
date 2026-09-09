from sqlalchemy import func, or_, select

from app.accounts.errors import AccountError
from app.core.db import SessionLocal
from app.core.time import iso_utc
from app.models import LlmCallLog, Workspace


def require_cross_workspace_logs(principal):
    if principal.auth_kind != "session" or not principal.allows("logs.cross_workspace"):
        raise AccountError("cross_workspace_logs_required")


async def log_workspaces(session, principal):
    require_cross_workspace_logs(principal)
    return [
        {"id": row.id, "name": row.name}
        for row in await session.scalars(select(Workspace).order_by(Workspace.name))
    ]


async def cross_workspace_logs(principal, workspace_ids, q, page, page_size):
    require_cross_workspace_logs(principal)
    targets = list(dict.fromkeys(workspace_ids or [principal.workspace_id]))
    async with SessionLocal() as session:
        found = set(await session.scalars(select(Workspace.id).where(Workspace.id.in_(targets))))
        if found != set(targets):
            raise AccountError("workspace_not_found")
        conditions = [LlmCallLog.workspace_id.in_(targets)]
        if q.strip():
            conditions.append(
                or_(
                    LlmCallLog.model.ilike(f"%{q.strip()}%"),
                    LlmCallLog.call_source.ilike(f"%{q.strip()}%"),
                )
            )
        total = await session.scalar(
            select(func.count()).select_from(LlmCallLog).where(*conditions)
        )
        rows = await session.scalars(
            select(LlmCallLog)
            .where(*conditions)
            .order_by(LlmCallLog.created_at.desc(), LlmCallLog.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return {
            "items": [
                {
                    **{
                        key: getattr(row, key)
                        for key in (
                            "id",
                            "workspace_id",
                            "call_source",
                            "provider_kind",
                            "model",
                            "status",
                            "latency_ms",
                            "total_tokens",
                        )
                    },
                    "created_at": iso_utc(row.created_at),
                }
                for row in rows
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

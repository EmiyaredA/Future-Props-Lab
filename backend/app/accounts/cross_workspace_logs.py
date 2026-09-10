from sqlalchemy import func, select

from app.accounts.errors import AccountError
from app.core.db import SessionLocal
from app.core.time import iso_utc
from app.llm.call_logs.query import log_conditions, today_stats
from app.models import LlmCallLog, Workspace
from app.schemas.call_log import CrossWorkspaceLogQuery


def require_cross_workspace_logs(principal):
    if principal.auth_kind != "session" or not principal.allows("logs.cross_workspace"):
        raise AccountError("cross_workspace_logs_required")


async def log_workspaces(session, principal):
    require_cross_workspace_logs(principal)
    return [
        {"id": row.id, "name": row.name}
        for row in await session.scalars(select(Workspace).order_by(Workspace.name))
    ]


async def validate_targets(session, principal, workspace_ids):
    targets = list(dict.fromkeys(workspace_ids or [principal.workspace_id]))
    found = set(await session.scalars(select(Workspace.id).where(Workspace.id.in_(targets))))
    if found != set(targets):
        raise AccountError("workspace_not_found")
    return targets


async def cross_workspace_stats(principal, workspace_ids):
    require_cross_workspace_logs(principal)
    async with SessionLocal() as session:
        targets = await validate_targets(session, principal, workspace_ids)
        return await today_stats(session, LlmCallLog.workspace_id.in_(targets))


async def cross_workspace_logs(principal, filters: CrossWorkspaceLogQuery):
    require_cross_workspace_logs(principal)
    async with SessionLocal() as session:
        targets = await validate_targets(session, principal, filters.workspace_ids)
        scope = LlmCallLog.workspace_id.in_(targets)
        query = filters.service_filters()
        page, page_size = query.pop("page"), query.pop("page_size")
        conditions = [scope, *log_conditions(**query, include_source_search=True)]
        model_options = list(
            await session.scalars(
                select(LlmCallLog.model).where(scope).distinct().order_by(LlmCallLog.model)
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
            "model_options": model_options,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

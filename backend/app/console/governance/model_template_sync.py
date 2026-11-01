"""Previewed, durable template reconciliation; one short transaction per account."""

from sqlalchemy import select, text

from app.capabilities.identity.errors import AccountError
from app.console.governance.governance_transactions import (
    begin_governance,
    cas,
    require_platform_admin,
)
from app.console.governance.model_templates import (
    apply_template,
    catalog_rows,
    reconciliation_preview,
)
from app.console.governance.service import add_audit_event
from app.console.governance.settings_records import read_setting
from app.console.models import User
from app.console.models.model_templates import ModelTemplateSyncItem as Item
from app.console.models.model_templates import ModelTemplateSyncJob as Job
from app.llm.models import ModelSupplier
from app.runtime.db import SessionLocal
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now


async def job_view(session, job_id):
    job = await session.get(Job, job_id)
    if job is None:
        raise AccountError("template_job_not_found")
    items = await session.scalars(
        select(Item).where(Item.job_id == job.id).order_by(Item.created_at, Item.id)
    )
    return {
        "id": job.id,
        "role": job.role,
        "template_revision": job.template_revision,
        "status": job.status,
        "revision": job.revision,
        "created_at": job.created_at,
        "items": [
            {
                key: getattr(item, key)
                for key in (
                    "id",
                    "owner_user_id",
                    "account_name",
                    "catalog_revision",
                    "status",
                    "summary",
                    "error_message",
                )
            }
            for item in items
        ],
    }


async def preview_sync(
    session, principal, role, expected_template_revision, client_ip, *, account_ids=None
):
    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    state = await read_setting(session, f"role_template:{role}", {})
    if state["revision"] != expected_template_revision:
        raise AccountError("revision_conflict", current={"revision": state["revision"]})
    if not state["value"].get("providers") and not state["value"].get("suppliers"):
        raise AccountError("template_not_configured")
    query = select(User).where(User.platform_role == role, User.status == "active")
    if account_ids is not None:
        query = query.where(User.id.in_(set(account_ids)))
    targets = (await session.scalars(query.order_by(User.id))).all()
    if account_ids is not None and {account.id for account in targets} != set(account_ids):
        raise AccountError("invalid_template_target")
    # Read snapshots with explicit account catalog filters. Each reader is short-lived.
    snapshots = []
    for account in targets:
        async with SessionLocal() as reader:
            providers, models, revision = await catalog_rows(reader, account.id)
            suppliers = list(
                await reader.scalars(
                    select(ModelSupplier).where(ModelSupplier.owner_user_id == account.id)
                )
            )
            summary = reconciliation_preview(state["value"], providers, models, suppliers)
            snapshots.append((account.id, account.display_name, revision, summary))
    job = Job(
        role=role,
        template_revision=state["revision"],
        template_snapshot=state["value"],
        actor_user_id=principal.user_id,
    )
    session.add(job)
    await session.flush()
    for owner_user_id, name, revision, summary in snapshots:
        session.add(
            Item(
                job_id=job.id,
                owner_user_id=owner_user_id,
                account_name=name,
                catalog_revision=revision,
                summary=summary,
            )
        )
    add_audit_event(
        session,
        "platform.model_template.previewed",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"role_to": role},
    )
    await session.commit()
    return await job_view(session, job.id)


async def start_sync(session, principal, job_id, expected_revision, client_ip):
    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    job = await session.get(Job, job_id)
    if job is None:
        raise AccountError("template_job_not_found")
    if job.status != "preview":
        raise AccountError("template_already_started_conflict")
    state = await read_setting(session, f"role_template:{job.role}", {})
    if state["revision"] != job.template_revision:
        raise AccountError("template_revision_conflict")
    active = await session.scalar(
        select(Job.id).where(Job.role == job.role, Job.status.in_(["pending", "running"]))
    )
    if active:
        raise AccountError("template_sync_active_conflict")
    await cas(
        session, Job, job.id, expected_revision, status="pending", actor_user_id=principal.user_id
    )
    add_audit_event(
        session,
        "platform.model_template.sync_started",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"role_to": job.role},
    )
    await session.commit()
    return await job_view(session, job_id)


class ModelTemplateSyncRunner(PollingTaskRunner):
    runner_name = "model-template-sync"
    poll_interval_seconds = 1.0

    async def recover(self):
        # An item and its catalog change commit together. Uncommitted work is safe to resume.
        return None

    async def process_once(self):
        async with SessionLocal() as session:
            ids = list(
                await session.scalars(
                    select(Job.id)
                    .where(Job.status.in_(["pending", "running"]))
                    .order_by(Job.created_at)
                )
            )
        for job_id in ids:
            async with SessionLocal() as session:
                await session.execute(text("BEGIN IMMEDIATE"))
                job = await session.get(Job, job_id)
                item = await session.scalar(
                    select(Item)
                    .where(Item.job_id == job_id, Item.status == "pending")
                    .order_by(Item.id)
                    .limit(1)
                )
                if item is None:
                    job.status = "completed"
                    job.revision += 1
                    job.updated_at = utc_now()
                    await session.commit()
                    continue
                actor = await session.get(User, job.actor_user_id)
                owner = await session.get(User, item.owner_user_id)
                if not actor or actor.status != "active" or actor.platform_role != "admin":
                    item.status, item.error_message = "skipped", "发起者已失去平台管理权限"
                elif not owner or owner.status != "active" or owner.platform_role != job.role:
                    item.status, item.error_message = "skipped", "拥有者的身份或状态已变化"
                else:
                    try:
                        async with session.begin_nested():
                            item.summary = await apply_template(
                                session,
                                item.owner_user_id,
                                job.template_snapshot,
                                item.catalog_revision,
                            )
                        item.status = "succeeded"
                    except AccountError as exc:
                        item.status, item.error_message = (
                            "skipped",
                            {
                                "catalog_revision_conflict": "目录已更新，请重新预览",
                                "template_catalog_conflict": "自建配置或模型引用冲突，请核对预览",
                            }.get(exc.code, "模板无法应用，请重新预览"),
                        )
                    except Exception:
                        item.status, item.error_message = "failed", "同步失败，已有目录已保留"
                item.updated_at = utc_now()
                job.status = "running"
                job.revision += 1
                add_audit_event(
                    session,
                    "platform.model_template.sync_item",
                    actor_user_id=job.actor_user_id,
                    owner_user_id=item.owner_user_id,
                    outcome="success" if item.status == "succeeded" else "failure",
                    metadata={"status_to": item.status},
                )
                await session.commit()


async def recent_jobs(session, role):
    ids = list(
        await session.scalars(
            select(Job.id).where(Job.role == role).order_by(Job.created_at.desc()).limit(20)
        )
    )
    return [await job_view(session, job_id) for job_id in ids]

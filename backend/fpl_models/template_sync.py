"""Previewed Models reconciliation with current Identity decisions and owned receipts."""

import time

from sqlalchemy import select, text, update

from app.capabilities.identity.errors import AccountError
from app.llm.catalog.template_reconciliation import (
    apply_template,
    catalog_rows,
    reconciliation_preview,
)
from app.llm.models import ModelSupplier
from app.llm.models import ModelTemplateSyncItem as Item
from app.llm.models import ModelTemplateSyncJob as Job
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now

from .audit import add_child_event, add_event
from .defaults import OwnedCatalogDefaults
from .models import TemplateSyncAuthority
from .task_usage import OwnedCatalogTaskUsage
from .templates import RoleTemplates


async def job_view(session, job_id):
    job = await session.get(Job, job_id, populate_existing=True)
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
                name: getattr(item, name)
                for name in (
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


class TemplateSynchronization(PollingTaskRunner):
    runner_name = "models-template-sync"
    poll_interval_seconds = 1

    def __init__(self, sessions, directory):
        super().__init__()
        self.sessions, self.directory = sessions, directory

    async def recover(self):
        pass

    async def preview(self, request, session, principal, role, body, *, audits):
        state = await RoleTemplates(session).snapshot(role)
        if state["revision"] != body.expected_template_revision:
            raise AccountError("revision_conflict", current={"revision": state["revision"]})
        if not state["value"].get("providers") and not state["value"].get("suppliers"):
            raise AccountError("template_not_configured")
        await session.rollback()
        prepared = await audits("platform.model_template.previewed", {"role_to": role})
        decision = await self.directory.targets(
            assertion=request.state.service_assertion,
            path=request.url.path,
            role=role,
            account_ids=body.account_ids,
        )
        if not decision.active:
            raise AccountError("account_access_forbidden")
        if body.account_ids is not None and {item.id for item in decision.targets} != set(
            body.account_ids
        ):
            raise AccountError("invalid_template_target")
        snapshots = []
        for target in decision.targets:
            async with self.sessions(info={"owner_user_id": target.id}) as reader:
                providers, models, revision = await catalog_rows(reader, target.id)
                suppliers = list(await reader.scalars(select(ModelSupplier)))
                snapshots.append(
                    (
                        target,
                        revision,
                        reconciliation_preview(state["value"], providers, models, suppliers),
                    )
                )
        await session.execute(text("BEGIN IMMEDIATE"))
        if (await RoleTemplates(session).snapshot(role))["revision"] != state["revision"]:
            raise AccountError("template_revision_conflict")
        # The current request was authenticated at ingress. Short Identity decisions
        # are never stretched across a large preview or held as cached authorization.
        if time.time() >= decision.expires_at:
            raise AccountError("account_access_forbidden")
        job = Job(
            role=role,
            template_revision=state["revision"],
            template_snapshot=state["value"],
            actor_user_id=principal.user_id,
        )
        session.add(job)
        await session.flush()
        for target, revision, summary in snapshots:
            session.add(
                Item(
                    job_id=job.id,
                    owner_user_id=target.id,
                    account_name=target.display_name,
                    catalog_revision=revision,
                    summary=summary,
                )
            )
        add_event(session, principal.user_id, prepared)
        await session.commit()
        return await job_view(session, job.id)

    async def start_job(self, request, session, principal, job_id, expected, *, audits):
        job = await session.get(Job, job_id)
        if job is None:
            raise AccountError("template_job_not_found")
        role = job.role
        await session.rollback()
        prepared = await audits("platform.model_template.sync_started", {"role_to": role})
        await session.execute(text("BEGIN IMMEDIATE"))
        job = await session.get(Job, job_id)
        if job is None:
            raise AccountError("template_job_not_found")
        if job.status != "preview":
            raise AccountError("template_already_started_conflict")
        if (await RoleTemplates(session).snapshot(job.role))["revision"] != job.template_revision:
            raise AccountError("template_revision_conflict")
        if await session.scalar(
            select(Job.id).where(Job.role == job.role, Job.status.in_(("pending", "running")))
        ):
            raise AccountError("template_sync_active_conflict")
        changed = await session.execute(
            update(Job)
            .where(Job.id == job_id, Job.revision == expected, Job.status == "preview")
            .values(
                status="pending",
                revision=expected + 1,
                actor_user_id=principal.user_id,
                updated_at=utc_now(),
            )
        )
        if changed.rowcount != 1:
            raise AccountError("revision_conflict", current={"revision": job.revision})
        session.add(
            TemplateSyncAuthority(
                job_id=job_id,
                source_path=request.url.path,
                assertion=request.state.service_assertion,
                audit_intent_id=str(prepared.receipt.id),
            )
        )
        add_event(session, principal.user_id, prepared)
        await session.commit()
        return await job_view(session, job_id)

    async def recent(self, session, role):
        ids = list(
            await session.scalars(
                select(Job.id).where(Job.role == role).order_by(Job.created_at.desc()).limit(20)
            )
        )
        return [await job_view(session, identity) for identity in ids]

    async def process_once(self):
        async with self.sessions() as session:
            ids = list(
                await session.scalars(
                    select(Job.id)
                    .where(Job.status.in_(("pending", "running")))
                    .order_by(Job.created_at)
                )
            )
        for identity in ids:
            await self.process_job(identity)

    async def process_job(self, identity):
        async with self.sessions() as reader:
            job = await reader.get(Job, identity)
            authority = await reader.get(TemplateSyncAuthority, identity)
            item = await reader.scalar(
                select(Item)
                .where(Item.job_id == identity, Item.status == "pending")
                .order_by(Item.id)
                .limit(1)
            )
            if job is None or job.status not in {"pending", "running"}:
                return
            source = (authority.assertion, authority.source_path) if authority else None
            role, actor_id = job.role, job.actor_user_id
            audit_parent = authority.audit_intent_id if authority else ""
            item_id, owner = (item.id, item.owner_user_id) if item else (None, None)
        decision = (
            await self.directory.targets(
                assertion=source[0],
                path=source[1],
                role=role,
                account_ids=[owner] if owner else None,
            )
            if source
            else None
        )
        async with self.sessions(info={"owner_user_id": owner} if owner else {}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            job = await session.get(Job, identity)
            if job is None or job.status not in {"pending", "running"}:
                return
            if decision is not None and time.time() >= decision.expires_at:
                return
            item = await session.get(Item, item_id) if item_id else None
            if item is None:
                if await session.scalar(
                    select(Item.id)
                    .where(Item.job_id == identity, Item.status == "pending")
                    .limit(1)
                ):
                    return
                job.status = "completed"
            elif item.status != "pending":
                return
            else:
                if decision is None or not decision.active:
                    item.status, item.error_message = "skipped", "发起者已失去平台管理权限"
                elif {target.id for target in decision.targets} != {owner}:
                    item.status, item.error_message = "skipped", "拥有者的身份或状态已变化"
                else:
                    try:
                        async with session.begin_nested():
                            item.summary = await apply_template(
                                session,
                                owner,
                                job.template_snapshot,
                                item.catalog_revision,
                                defaults_store=OwnedCatalogDefaults(session),
                                task_usage=OwnedCatalogTaskUsage(session),
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
                item.updated_at = utc_now()
                job.status = "running"
            job.revision += 1
            job.updated_at = utc_now()
            if audit_parent:
                add_child_event(
                    session, actor_id, audit_parent, item.status if item else "completed"
                )
            await session.commit()

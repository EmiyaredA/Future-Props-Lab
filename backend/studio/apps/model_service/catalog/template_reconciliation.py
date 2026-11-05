"""Stable-ID catalogue reconciliation, independent of governance and other task stores."""

from copy import deepcopy
from typing import Protocol

from sqlalchemy import select, update

from studio.apps.model_service.catalog.default_storage import CatalogDefaults
from studio.apps.model_service.storage.models.model_service import (
    ModelCatalogState,
    ModelEntry,
    ModelProvider,
)
from studio.apps.model_service.storage.models.model_supplier import ModelSupplier
from studio.contracts.identity.errors import AccountError
from studio.runtime.time import utc_now


class AccountTaskUsage(Protocol):
    async def account_active(self, *, owner_user_id: str) -> bool: ...


async def catalog_rows(session, owner_user_id):
    providers = list(
        await session.scalars(
            select(ModelProvider).where(ModelProvider.owner_user_id == owner_user_id)
        )
    )
    models = list(
        await session.scalars(select(ModelEntry).where(ModelEntry.owner_user_id == owner_user_id))
    )
    state = await session.get(ModelCatalogState, owner_user_id)
    return providers, models, state.revision if state else 0


def reconciliation_preview(payload, providers, models, suppliers=()):
    p_by_key = {p.template_key: p for p in providers if p.origin == "role_template"}
    m_by_key = {m.template_key: m for m in models if m.origin == "role_template"}
    summary = {"added": [], "updated": [], "retained": [], "conflicts": [], "defaults": []}
    supplier_names = {item.name.casefold() for item in suppliers if item.origin == "user"}
    for supplier in payload.get("suppliers", []):
        if supplier["name"].casefold() in supplier_names:
            summary["conflicts"].append(f"自建供应商重名：{supplier['name']}")
    user_names = {p.name.casefold() for p in providers if p.origin != "role_template"}
    for p in payload.get("providers", []):
        if p["name"].casefold() in user_names:
            summary["conflicts"].append(f"自建连接重名：{p['name']}")
        summary["updated" if p["template_key"] in p_by_key else "added"].append(p["name"])
        for m in p.get("models", []):
            existing = m_by_key.get(m["template_key"])
            parent = p_by_key.get(p["template_key"])
            if existing and (parent is None or existing.provider_id != parent.id):
                summary["conflicts"].append(f"模型不能跨连接移动：{m['slug']}")
    # References may be embedded in project JSON. Never delete disappeared template items.
    next_keys = {
        m["template_key"] for p in payload.get("providers", []) for m in p.get("models", [])
    }
    retained_count = sum(
        m.origin != "role_template" or m.template_key not in next_keys for m in models
    )
    summary["retained"] = ["现有模型"] * retained_count
    summary["defaults"] = [
        f"{purpose}: {key}" for purpose, key in payload.get("defaults", {}).items()
    ]
    return summary


async def apply_template(
    session,
    owner_user_id,
    payload,
    expected_revision,
    *,
    defaults_store: CatalogDefaults,
    task_usage: AccountTaskUsage,
):
    if session.info.get("owner_user_id") != owner_user_id:
        raise ValueError("模板合并缺少匹配的账号上下文")
    providers, models, revision = await catalog_rows(session, owner_user_id)
    if revision != expected_revision:
        raise AccountError("catalog_revision_conflict")
    suppliers = list(
        await session.scalars(
            select(ModelSupplier).where(ModelSupplier.owner_user_id == owner_user_id)
        )
    )
    summary = reconciliation_preview(payload, providers, models, suppliers)
    if await task_usage.account_active(owner_user_id=owner_user_id):
        summary["conflicts"].append("账号有活动模型任务，请在任务结束后重新预览")
    if summary["conflicts"]:
        raise AccountError("template_catalog_conflict", current=summary)
    result = await session.execute(
        update(ModelCatalogState)
        .where(
            ModelCatalogState.owner_user_id == owner_user_id,
            ModelCatalogState.revision == expected_revision,
        )
        .values(revision=expected_revision + 1, updated_at=utc_now())
    )
    if result.rowcount != 1:
        raise AccountError("catalog_revision_conflict")
    suppliers = list(
        await session.scalars(
            select(ModelSupplier).where(ModelSupplier.owner_user_id == owner_user_id)
        )
    )
    by_supplier = {item.template_key: item for item in suppliers if item.origin == "role_template"}
    custom_names = {item.name.casefold() for item in suppliers if item.origin == "user"}
    for raw in payload.get("suppliers", []):
        if raw["name"].casefold() in custom_names:
            raise AccountError("template_catalog_conflict")
        supplier = by_supplier.get(raw["template_key"])
        if supplier is None:
            supplier = ModelSupplier(
                owner_user_id=owner_user_id,
                template_key=raw["template_key"],
                origin="role_template",
                name=raw["name"],
            )
            session.add(supplier)
            by_supplier[raw["template_key"]] = supplier
        supplier.name = raw["name"]
    await session.flush()
    by_p = {p.template_key: p for p in providers if p.origin == "role_template"}
    by_m = {m.template_key: m for m in models if m.origin == "role_template"}
    for source in payload.get("providers", []):
        p = by_p.get(source["template_key"])
        if p is None:
            p = ModelProvider(
                owner_user_id=owner_user_id,
                origin="role_template",
                template_key=source["template_key"],
                enabled=source.get("enabled", True),
                sort_order=len(providers),
            )
            session.add(p)
            providers.append(p)
        p.supplier_id = (
            by_supplier[source["supplier_key"]].id if source.get("supplier_key") else None
        )
        for key in ("name", "kind", "base_url", "api_key_ciphertext"):
            setattr(p, key, source.get(key, ""))
        await session.flush()
        for index, raw in enumerate(source.get("models", [])):
            m = by_m.get(raw["template_key"])
            if m is None:
                m = ModelEntry(
                    owner_user_id=owner_user_id,
                    provider_id=p.id,
                    origin="role_template",
                    template_key=raw["template_key"],
                    enabled=raw.get("enabled", True),
                    sort_order=index,
                )
                session.add(m)
                by_m[raw["template_key"]] = m
            for key in ("slug", "label", "description", "capabilities", "categories"):
                setattr(m, key, raw.get(key, [] if key in {"capabilities", "categories"} else ""))
        await session.flush()
    # Empty groups removed from a template may be deleted; groups still referenced by
    # preserved or custom connections must remain, so existing model IDs never move.
    desired_suppliers = {item["template_key"] for item in payload.get("suppliers", [])}
    referenced_suppliers = {provider.supplier_id for provider in providers}
    for supplier in suppliers:
        if (
            supplier.origin == "role_template"
            and supplier.template_key not in desired_suppliers
            and supplier.id not in referenced_suppliers
        ):
            await session.delete(supplier)
    selection = deepcopy(await defaults_store.read(owner_user_id=owner_user_id))
    enabled_providers = {p.id for p in providers if p.enabled}
    available = {m.id: m for m in [*models, *by_m.values()] if m.provider_id in enabled_providers}
    for purpose, key in payload.get("defaults", {}).items():
        existing = available.get(selection.get(purpose))
        if existing is None or not existing.enabled or purpose not in existing.capabilities:
            candidate = by_m[key]
            if candidate.enabled and candidate.provider_id in enabled_providers:
                selection[purpose] = candidate.id
            else:
                selection.pop(purpose, None)
    await defaults_store.replace(owner_user_id=owner_user_id, model_ids=selection)
    await session.flush()
    return summary

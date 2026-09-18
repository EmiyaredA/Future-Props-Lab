"""Role template storage and explicit workspace catalog reconciliation."""

from copy import deepcopy

from sqlalchemy import select, update

from app.capabilities.identity.errors import AccountError
from app.console.governance.governance_transactions import (
    begin_governance,
    cas,
    require_platform_admin,
)
from app.console.governance.platform_policy import read_setting
from app.console.governance.runtime_quotas import ACTIVE, TASK_MODELS
from app.console.governance.service import add_audit_event
from app.llm.catalog.metadata import categories_for_provider
from app.models import ModelCatalogState, ModelEntry, ModelProvider
from app.models.model_supplier import ModelSupplier
from app.models.platform_governance import PlatformSetting
from app.runtime.credentials import encrypt_secret
from app.runtime.secret_hints import encrypted_secret_hint
from app.runtime.time import utc_now


def template_view(payload):
    value = deepcopy(payload)
    for provider in value.get("providers", []):
        ciphertext = provider.pop("api_key_ciphertext", "")
        provider.pop("api_key", None)
        provider.update(
            has_api_key=bool(ciphertext), api_key_hint=encrypted_secret_hint(ciphertext)
        )
    return value


async def get_template(session, role):
    state = await read_setting(session, f"role_template:{role}", {"providers": [], "defaults": {}})
    return {"role": role, "revision": state["revision"], "value": template_view(state["value"])}


async def save_template(session, principal, role, body, client_ip):
    # Input carries only replacement secrets. Output never returns ciphertext or plaintext.

    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    current = await read_setting(
        session, f"role_template:{role}", {"providers": [], "defaults": {}}
    )
    if current["revision"] != body.expected_revision:
        raise AccountError(
            "revision_conflict",
            current={"revision": current["revision"], "value": template_view(current["value"])},
        )
    old = {p["template_key"]: p for p in current["value"].get("providers", [])}
    value = body.value.model_dump()
    for provider, source in zip(value["providers"], body.value.providers, strict=True):
        for model in provider.get("models", []):
            model["categories"] = model.get("categories") or categories_for_provider(
                provider["kind"]
            )
        provider.pop("has_api_key", None)
        provider.pop("api_key_hint", None)
        provider["api_key_ciphertext"] = (
            encrypt_secret(source.api_key)
            if source.api_key.strip()
            else ""
            if source.clear_api_key
            else old.get(source.template_key, {}).get("api_key_ciphertext", "")
        )
    # Keep authorization and CAS under the same writer transaction.

    row = await session.get(PlatformSetting, f"role_template:{role}")
    if row:
        await cas(session, PlatformSetting, row.id, body.expected_revision, payload=value)
    else:
        session.add(PlatformSetting(id=f"role_template:{role}", payload=value, revision=1))
    add_audit_event(
        session,
        "platform.model_template.updated",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"role_to": role, "revision": body.expected_revision + 1},
    )
    await session.commit()
    return await get_template(session, role)


async def catalog_rows(session, workspace_id):
    providers = list(
        await session.scalars(
            select(ModelProvider).where(ModelProvider.workspace_id == workspace_id)
        )
    )
    models = list(
        await session.scalars(select(ModelEntry).where(ModelEntry.workspace_id == workspace_id))
    )
    state = await session.get(ModelCatalogState, workspace_id)
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
    summary["retained"] = [
        m.slug for m in models if m.origin != "role_template" or m.template_key not in next_keys
    ]
    summary["defaults"] = [
        f"{purpose}: {key}" for purpose, key in payload.get("defaults", {}).items()
    ]
    return summary


async def apply_template(session, workspace_id, payload, expected_revision):
    providers, models, revision = await catalog_rows(session, workspace_id)
    if revision != expected_revision:
        raise AccountError("catalog_revision_conflict")
    suppliers = list(
        await session.scalars(
            select(ModelSupplier).where(ModelSupplier.workspace_id == workspace_id)
        )
    )
    summary = reconciliation_preview(payload, providers, models, suppliers)
    for model in TASK_MODELS.values():
        active = await session.scalar(
            select(model.id)
            .where(model.workspace_id == workspace_id, model.status.in_(ACTIVE))
            .limit(1)
        )
        if active:
            summary["conflicts"].append("工作区有活动模型任务，请在任务结束后重新预览")
            break
    if summary["conflicts"]:
        raise AccountError("template_catalog_conflict", current=summary)
    result = await session.execute(
        update(ModelCatalogState)
        .where(
            ModelCatalogState.workspace_id == workspace_id,
            ModelCatalogState.revision == expected_revision,
        )
        .values(revision=expected_revision + 1, updated_at=utc_now())
    )
    if result.rowcount != 1:
        raise AccountError("catalog_revision_conflict")
    suppliers = list(
        await session.scalars(
            select(ModelSupplier).where(ModelSupplier.workspace_id == workspace_id)
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
                workspace_id=workspace_id,
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
                workspace_id=workspace_id,
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
                    workspace_id=workspace_id,
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
    defaults_key = f"workspace_defaults:{workspace_id}"
    defaults = await session.get(PlatformSetting, defaults_key)
    selection = deepcopy(defaults.payload if defaults else {})
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
    if defaults:
        defaults.payload = selection
        defaults.revision += 1
    else:
        session.add(PlatformSetting(id=defaults_key, payload=selection, revision=1))
    await session.flush()
    return summary


async def initialize_from_template(session, workspace_id, role):
    state = await read_setting(session, f"role_template:{role}", {})
    if not state["value"].get("providers") and not state["value"].get("suppliers"):
        return False
    session.add(ModelCatalogState(workspace_id=workspace_id, revision=0))
    await session.flush()
    await apply_template(session, workspace_id, state["value"], 0)
    return True

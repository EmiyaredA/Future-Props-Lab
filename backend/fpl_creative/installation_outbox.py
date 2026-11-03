"""Durable, account-scoped installation intents before any target network call.

Callers must authenticate the owner and derive Skill archive descriptors from
Creative-owned bytes. This is a storage primitive, not an authorization port.
Uncertain target outcomes remain pending and must reuse the persisted batch.
"""

from dataclasses import dataclass

from sqlalchemy import select, text

from app.console.creative_workshop.models import (
    CreativeInstallation,
    CreativeItem,
    CreativeRelease,
)
from app.console.creative_workshop.schemas import CreativeInstallOut, CreativeInstallPreviewIn
from fpl_runtime.creative_integrations import CreativeInstallBatch
from fpl_runtime.integration_intents import digest

from .installation_records import CreativeInstallOperation


class InstallIntentConflict(ValueError):
    """The same account and release already have a different immutable intent."""


@dataclass(frozen=True)
class InstallIntent:
    batch: CreativeInstallBatch
    fingerprint: str
    state: str
    receipt: dict | None


def _intent(row):
    batch = CreativeInstallBatch.model_validate(row.batch)
    if (
        batch.operation_id != row.operation_id
        or batch.root_release_id != row.root_release_id
        or digest(row.batch) != row.batch_fingerprint
    ):
        raise InstallIntentConflict("持久安装批次校验失败")
    return InstallIntent(batch, row.batch_fingerprint, row.state, row.receipt)


async def _validate_new_batch(session, request, batch):
    root = await session.get(CreativeRelease, batch.root_release_id)
    item = await session.get(CreativeItem, root.item_id) if root else None
    if item is None or item.status != "published":
        raise InstallIntentConflict("公开能力版本不存在")
    ids = list(root.components) if item.kind == "bundle" else [root.id]
    if not ids or len(ids) != len(set(ids)) or ids != [part.release_id for part in batch.parts]:
        raise InstallIntentConflict("安装批次与公开版本不匹配")
    for part in batch.parts:
        release = await session.get(CreativeRelease, part.release_id)
        source = await session.get(CreativeItem, release.item_id) if release else None
        if source is None or source.status != "published" or source.kind == "bundle":
            raise InstallIntentConflict("公开能力版本不可安装")
        name = request.names.get(release.id, release.title).strip()
        if (
            source.kind != part.kind
            or release.title != part.title
            or release.summary != part.summary
            or release.tags != part.tags
            or release.manifest != part.manifest
            or name != part.target_name
        ):
            raise InstallIntentConflict("安装批次与公开版本不匹配")
        if part.skill and (
            part.skill.file_count != release.manifest.get("file_count")
            or part.skill.expanded_bytes != release.manifest.get("expanded_bytes")
        ):
            raise InstallIntentConflict("Skill 描述与公开版本不匹配")


class InstallationOutbox:
    def __init__(self, database):
        self.database = database

    async def accept(
        self, owner: str, request: CreativeInstallPreviewIn, batch: CreativeInstallBatch
    ):
        if not owner or request.release_id != batch.root_release_id:
            raise ValueError("安装请求与批次不匹配")
        request_hash = digest(request.model_dump(mode="json"))
        batch_value = batch.model_dump(mode="json")
        checksum = digest(batch_value)
        # SQLite serializes competing initial acceptance before checking the unique slot.
        # No external I/O is performed while holding this transaction.
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.scalar(
                select(CreativeInstallOperation).where(
                    CreativeInstallOperation.owner_user_id == owner,
                    CreativeInstallOperation.root_release_id == batch.root_release_id,
                )
            )
            if row is not None:
                existing = _intent(row)
                previous = existing.batch.model_dump(mode="json")
                previous.pop("operation_id")
                proposed = dict(batch_value)
                proposed.pop("operation_id")
                if row.request_fingerprint != request_hash or previous != proposed:
                    raise InstallIntentConflict("原安装批次尚未解决，不能更改请求")
                return existing
            await _validate_new_batch(session, request, batch)
            row = CreativeInstallOperation(
                operation_id=batch.operation_id,
                owner_user_id=owner,
                root_release_id=batch.root_release_id,
                request_fingerprint=request_hash,
                batch_fingerprint=checksum,
                batch=batch_value,
                state="pending",
            )
            session.add(row)
            await session.flush()
            result = _intent(row)
            # If acknowledgement is lost, the next call observes the same persisted UUID.
            await session.commit()
            return result

    async def require_current(
        self, owner: str, request: CreativeInstallPreviewIn, batch: CreativeInstallBatch
    ) -> None:
        """Reject a first target application if a release is no longer public."""
        if not owner or request.release_id != batch.root_release_id:
            raise InstallIntentConflict("安装请求与批次不匹配")
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await _validate_new_batch(session, request, batch)

    async def get(self, owner: str, root_release_id: str) -> InstallIntent | None:
        if not owner:
            raise ValueError("安装查询缺少账号")
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.scalar(
                select(CreativeInstallOperation).where(
                    CreativeInstallOperation.owner_user_id == owner,
                    CreativeInstallOperation.root_release_id == root_release_id,
                )
            )
            return _intent(row) if row is not None else None

    async def complete(self, owner: str, root_release_id: str, receipt: dict) -> CreativeInstallOut:
        """Atomically record an authenticated target receipt and source installations.

        Only a trusted, request-bound Integrations client may supply this receipt.
        A missing or ambiguous network result must never call this method.
        """
        if not owner or not isinstance(receipt, dict):
            raise ValueError("安装回执无效")
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.scalar(
                select(CreativeInstallOperation).where(
                    CreativeInstallOperation.owner_user_id == owner,
                    CreativeInstallOperation.root_release_id == root_release_id,
                )
            )
            if row is None:
                raise InstallIntentConflict("安装批次不存在")
            intent = _intent(row)
            if set(receipt) != {"operation_id", "root_release_id", "resources"} or (
                receipt["operation_id"] != intent.batch.operation_id
                or receipt["root_release_id"] != root_release_id
                or not isinstance(receipt["resources"], list)
                or len(receipt["resources"]) != len(intent.batch.parts)
            ):
                raise InstallIntentConflict("安装回执与批次不匹配")
            for part, resource in zip(intent.batch.parts, receipt["resources"], strict=True):
                if (
                    not isinstance(resource, dict)
                    or set(resource) != {"release_id", "kind", "name", "resource_id", "state"}
                    or resource["release_id"] != part.release_id
                    or resource["kind"] != part.kind
                    or not isinstance(resource["name"], str)
                    or not resource["name"]
                    or not isinstance(resource["resource_id"], str)
                    or not (
                        (resource["state"] == "disabled" and resource["resource_id"])
                        or (
                            part.kind == "mcp"
                            and resource["state"] == "pending_setup"
                            and resource["resource_id"] == ""
                        )
                    )
                ):
                    raise InstallIntentConflict("安装回执资源无效")
            if row.state == "completed" and row.receipt != receipt:
                raise InstallIntentConflict("安装回执与已完成记录不一致")
            if row.state not in {"pending", "completed"}:
                raise InstallIntentConflict("安装批次状态无效")
            expected = {
                part.release_id: [resource]
                for part, resource in zip(intent.batch.parts, receipt["resources"], strict=True)
                if part.release_id != root_release_id
            }
            expected[root_release_id] = receipt["resources"]
            root = None
            for release_id, resources in expected.items():
                installation = await session.scalar(
                    select(CreativeInstallation).where(
                        CreativeInstallation.owner_user_id == owner,
                        CreativeInstallation.release_id == release_id,
                    )
                )
                if installation is None:
                    installation = CreativeInstallation(
                        owner_user_id=owner,
                        installed_by_user_id=owner,
                        release_id=release_id,
                        resources=resources,
                    )
                    session.add(installation)
                    await session.flush()
                elif installation.resources != resources:
                    raise InstallIntentConflict("已有安装记录与目标回执不一致")
                if release_id == root_release_id:
                    root = installation
            row.state = "completed"
            row.receipt = receipt
            result = CreativeInstallOut(
                id=root.id, release_id=root_release_id, resources=root.resources
            )
            await session.commit()
            return result

"""Atomic retention replacement and replay; no foreign database or remote transaction."""

import hashlib
import json

from sqlalchemy import delete, select, text

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.runtime.ids import new_id
from fpl_runtime.asset_references import VIDEO_FILE_CHANGES, ReferenceUpdate

from .models import (
    AssetReferencePin,
    AssetReferenceReceipt,
    AssetReferenceSet,
    PreparedAssetPin,
    ReferenceIntent,
    VisualProjectFileLink,
)


class AssetReferences:
    def __init__(self, database):
        self.database = database

    @staticmethod
    async def session_has_pending(session, reference_set_id):
        return (
            await session.scalar(
                select(ReferenceIntent.id)
                .where(
                    ReferenceIntent.reference_set_id == reference_set_id,
                    ReferenceIntent.state == "prepared",
                )
                .limit(1)
            )
            is not None
        )

    async def replace(self, *, owner, service, update: ReferenceUpdate):
        """Import or verify an already committed source snapshot.

        Live source mutations use ReferenceChanges so each pending intent has
        independent pins and an explicit durable outcome.
        """
        update = update.model_copy(deep=True)
        update.validate_service(service)
        if update.resource_kind in VIDEO_FILE_CHANGES:
            raise AssetError("素材变更须通过源操作提交", code="invalid_reference_kind", status=422)
        payload = update.model_dump(mode="json")
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        async with self.database.sessions() as session:
            session.info["owner_user_id"] = owner
            await session.execute(text("BEGIN IMMEDIATE"))
            receipt = await session.scalar(
                select(AssetReferenceReceipt).where(
                    AssetReferenceReceipt.service_id == service,
                    AssetReferenceReceipt.request_id == update.request_id,
                )
            )
            if receipt is not None:
                if receipt.payload_sha256 != digest:
                    raise AssetError(
                        "请求 ID 已用于不同的素材引用", code="request_id_conflict", status=409
                    )
                return receipt.result
            row = await session.scalar(
                select(AssetReferenceSet).where(
                    AssetReferenceSet.service_id == service,
                    AssetReferenceSet.resource_kind == update.resource_kind,
                    AssetReferenceSet.resource_id == update.resource_id,
                )
            )
            if row is not None and row.deleted:
                raise AssetError("源资源已删除", code="not_found", status=404)
            if row is not None and await self.session_has_pending(session, row.id):
                raise AssetError(
                    "引用变更尚未确定，不能覆盖投影", code="reference_mutations_pending", status=409
                )
            current = row.revision if row is not None else 0
            if update.expected_revision != current:
                raise AssetError(
                    "素材引用版本冲突",
                    code="revision_conflict",
                    status=409,
                    detail={"current_revision": current},
                )
            if row is not None and update.resource_revision < row.resource_revision:
                raise AssetError(
                    "不能回退已确认的资源版本", code="resource_revision_conflict", status=409
                )
            requested = set(update.asset_ids)
            await protect_pending_removals(session, requested)
            present = (
                set(
                    (
                        await session.scalars(
                            select(VisualAsset.id).where(VisualAsset.id.in_(requested))
                        )
                    ).all()
                )
                if requested
                else set()
            )
            if present != requested:
                raise AssetError("部分素材不存在", code="not_found", status=404)
            if row is not None and update.resource_revision == row.resource_revision:
                retained = set(
                    (
                        await session.scalars(
                            select(AssetReferencePin.asset_id).where(
                                AssetReferencePin.reference_set_id == row.id,
                            )
                        )
                    ).all()
                )
                if not retained <= requested:
                    raise AssetError(
                        "同一资源版本不能释放其他准备步骤保留的素材",
                        code="pending_reference_conflict",
                        status=409,
                        detail={
                            "current_revision": row.revision,
                            "current_asset_ids": sorted(retained),
                        },
                    )
            if row is None:
                row = AssetReferenceSet(
                    id=new_id(),
                    owner_user_id=owner,
                    service_id=service,
                    resource_kind=update.resource_kind,
                    resource_id=update.resource_id,
                    resource_revision=update.resource_revision,
                    revision=0,
                )
                session.add(row)
                await session.flush()
            row.revision += 1
            row.resource_revision = update.resource_revision
            await session.execute(
                delete(AssetReferencePin).where(
                    AssetReferencePin.reference_set_id == row.id,
                )
            )
            session.add_all(
                [
                    AssetReferencePin(
                        reference_set_id=row.id, asset_id=asset_id, owner_user_id=owner
                    )
                    for asset_id in sorted(requested)
                ]
            )
            result = {
                "revision": row.revision,
                "resource_revision": row.resource_revision,
                "asset_ids": sorted(requested),
            }
            session.add(
                AssetReferenceReceipt(
                    owner_user_id=owner,
                    service_id=service,
                    request_id=update.request_id,
                    payload_sha256=digest,
                    result=result,
                )
            )
            await session.commit()
            return result


async def protect_references(session, asset_ids):
    """Call while holding the same short write transaction as asset deletion."""
    if not asset_ids:
        return
    for model in (AssetReferencePin, PreparedAssetPin, VisualProjectFileLink):
        if (
            await session.scalar(
                select(model.asset_id).where(model.asset_id.in_(asset_ids)).limit(1)
            )
            is not None
        ):
            raise AssetError("素材仍被应用或历史引用", code="asset_in_use", status=409)


async def protect_pending_removals(session, asset_ids):
    if not asset_ids:
        return
    reserved = await session.scalar(
        select(PreparedAssetPin.asset_id)
        .join(ReferenceIntent, ReferenceIntent.id == PreparedAssetPin.intent_id)
        .join(AssetReferenceSet, AssetReferenceSet.id == ReferenceIntent.reference_set_id)
        .where(
            AssetReferenceSet.service_id.in_(("galgame", "video")),
            AssetReferenceSet.resource_kind == "file-removal",
            ReferenceIntent.state == "prepared",
            PreparedAssetPin.asset_id.in_(asset_ids),
        )
        .limit(1)
    )
    if reserved is not None:
        raise AssetError("素材正在删除", code="reference_mutations_pending", status=409)

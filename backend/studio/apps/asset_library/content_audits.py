"""Prepare exact-content groups and expose resumable, owner-bound audit decisions."""

import copy
from collections import defaultdict
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from studio.apps.asset_library.content_fingerprints import ContentFingerprints, snapshot
from studio.apps.asset_library.storage.content_models import AssetDedupeOperation
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.service_models import (
    AssetDeletion, AssetReferencePin, AssetReferenceSet, PreparedAssetPin, VisualProjectFileLink,
)
from studio.contracts.asset_library.content_identity import (
    ContentAudit, ContentIdentities, ContentIdentity, DuplicateGroup, DuplicateMember,
)
from studio.contracts.asset_library.errors import AssetError


def serialized(item):
    return {key: value.isoformat() if hasattr(value, "isoformat") else value for key, value in item.items()}


class ContentAudits:
    def __init__(self, files):
        self.files, self.session, self.owner = files, files.session, files.owner_user_id
        self.index = ContentFingerprints(files)

    async def identities(self, ids):
        seeds = []
        for identity in dict.fromkeys(ids):
            row = await self.files._asset(identity)
            if row.owner_user_id != self.owner:
                raise AssetError("素材不存在", code="not_found", status=404)
            seeds.append(snapshot(row))
        await self.session.rollback()
        items = await self.index.candidates(sizes={item["byte_size"] for item in seeds})
        keys, missing = await self.index.fingerprints(items)
        groups = defaultdict(list)
        for identity, key in keys.items():
            groups[key].append(identity)
        return ContentIdentities(
            items=[ContentIdentity(asset_id=item["id"], content_key=keys[item["id"]],
                                   equivalent_ids=sorted(groups[keys[item["id"]]]))
                   for item in seeds if item["id"] in keys],
            unavailable_ids=[item["id"] for item in seeds if item["id"] not in keys],
        )

    async def protections(self, ids):
        result = defaultdict(set)
        for asset, service, kind in await self.session.execute(
            select(AssetReferencePin.asset_id, AssetReferenceSet.service_id, AssetReferenceSet.resource_kind)
            .join(AssetReferenceSet, AssetReferenceSet.id == AssetReferencePin.reference_set_id)
            .where(AssetReferencePin.owner_user_id == self.owner, AssetReferencePin.asset_id.in_(ids))
        ):
            result[asset].add(f"{service}:{kind}")
        for asset in await self.session.scalars(select(PreparedAssetPin.asset_id).where(
            PreparedAssetPin.owner_user_id == self.owner, PreparedAssetPin.asset_id.in_(ids)
        )):
            result[asset].add("prepared-reference")
        for asset in await self.session.scalars(select(VisualProjectFileLink.asset_id).where(
            VisualProjectFileLink.owner_user_id == self.owner, VisualProjectFileLink.asset_id.in_(ids)
        )):
            result[asset].add("project-placement")
        return result

    async def create(self, body):
        existing = await self.session.scalar(select(AssetDedupeOperation).where(
            AssetDedupeOperation.owner_user_id == self.owner,
            AssetDedupeOperation.request_id == body.request_id,
        ))
        if existing:
            if existing.document["project_ids"] != sorted(set(body.project_ids)):
                raise AssetError("同一请求不能更换项目范围", code="dedupe_request_conflict", status=409)
            return await self.status(existing.id)
        for project in sorted(set(body.project_ids)):
            await self.files._project(project)
        await self.session.rollback()
        items = await self.index.candidates(project_ids=body.project_ids)
        sizes = defaultdict(list)
        for item in items:
            sizes[(item["media_kind"], item["byte_size"])].append(item)
        candidates = [item for group in sizes.values() if len(group) > 1 and any(
            item["project_id"] in body.project_ids for item in group
        ) for item in group]
        keys, missing = await self.index.fingerprints(candidates)
        groups = defaultdict(list)
        for item in candidates:
            if item["id"] in keys:
                groups[keys[item["id"]]].append(item)
        protection = await self.protections(list(keys))
        document = {"project_ids": sorted(set(body.project_ids)), "groups": {}, "unavailable_ids": missing}
        for key, group in sorted(groups.items()):
            if len(group) < 2 or not any(item["project_id"] in body.project_ids for item in group):
                continue
            ordered = sorted(group, key=lambda item: (item["project_id"] is not None, item["created_at"], item["id"]))
            public = DuplicateGroup(content_key=key, canonical_id=ordered[0]["id"], members=[
                DuplicateMember(**serialized(item), protected_by=sorted(protection[item["id"]]))
                for item in ordered
            ])
            document["groups"][key] = {"public": public.model_dump(), "originals": [serialized(item) for item in ordered]}
        identity = str(uuid4())
        self.session.add(AssetDedupeOperation(id=identity, owner_user_id=self.owner,
                                           request_id=body.request_id, revision=0, document=document))
        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            return await self.create(body)
        return await self.status(identity)

    async def load(self, identity):
        row = await self.session.get(AssetDedupeOperation, identity, populate_existing=True)
        if not row or row.owner_user_id != self.owner:
            raise AssetError("去重操作不存在", code="not_found", status=404)
        version, document = row.revision, copy.deepcopy(row.document)
        await self.session.rollback()
        return version, document

    async def save(self, identity, expected, document, *, commit=True):
        result = await self.session.execute(update(AssetDedupeOperation).where(
            AssetDedupeOperation.id == identity, AssetDedupeOperation.owner_user_id == self.owner,
            AssetDedupeOperation.revision == expected,
        ).values(revision=expected + 1, document=document))
        if result.rowcount != 1:
            await self.session.rollback()
            raise AssetError("去重操作已变化，请重新读取", code="dedupe_conflict", status=409)
        if commit:
            await self.session.commit()

    async def status(self, identity):
        version, document = await self.load(identity)
        groups = []
        for group in document["groups"].values():
            public = DuplicateGroup.model_validate(group["public"])
            completed = set(await self.session.scalars(select(AssetDeletion.asset_id).where(
                AssetDeletion.owner_user_id == self.owner, AssetDeletion.asset_id.in_(public.removed_ids),
                AssetDeletion.status == "completed",
            )))
            public.reclaimed_bytes = sum(item["byte_size"] for item in group["originals"] if item["id"] in completed)
            groups.append(public)
        await self.session.rollback()
        return ContentAudit(id=identity, revision=version, project_ids=document["project_ids"],
                            groups=groups, unavailable_ids=document["unavailable_ids"])

    def group(self, document, key):
        group = document["groups"].get(key)
        if group is None:
            raise AssetError("内容组不属于本次操作", code="not_found", status=404)
        return group

    async def revalidate(self, document, group):
        for project in document["project_ids"]:
            await self.files._project(project)
        items = []
        for item in group["originals"]:
            if item["id"] in group["public"]["removed_ids"]:
                continue
            row = await self.files._asset(item["id"])
            if row.owner_user_id != self.owner or row.revision != item["revision"]:
                raise AssetError("素材在审计后已修改", code="dedupe_conflict", status=409)
            items.append(snapshot(row))
        if reserved := group.get("canonical"):
            row = await self.files._asset(reserved["id"])
            items.append(snapshot(row))
        await self.session.rollback()
        keys, missing = await self.index.fingerprints(items, fresh=True)
        if missing or any(key != group["public"]["content_key"] for key in keys.values()):
            raise AssetError("原件已变化或无法读取，停止清理", code="dedupe_content_changed", status=409)
        return items

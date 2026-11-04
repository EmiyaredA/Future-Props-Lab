"""Prospective retention is separate from committed source snapshots.

Only a source transaction's durable outcome may commit or abort an intent.
Unknown outcomes keep their pins indefinitely; there is no expiry cleanup.
"""

import time

from sqlalchemy import delete, func, select, text

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.runtime.ids import new_id
from fpl_runtime.annotation_assets import MAX_AUDIO_BYTES
from fpl_runtime.asset_references import VIDEO_FILE_CHANGES, PrepareReferenceChange
from fpl_runtime.retention_authority import canvas_metadata, change_digest, story_metadata
from fpl_runtime.thought_assets import AssetDescription

from . import galgame_file_changes, video_file_changes
from .canvas_retention import canvas_files
from .models import AssetReferencePin, AssetReferenceSet, PreparedAssetPin, ReferenceIntent
from .references import protect_pending_removals
from .scoped_project_files import PROJECT_FILE_COLUMNS, files_for_removal, remove_files


def failure(code, message, status=409):
    return AssetError(message, code=code, status=status)


async def owned_intent(session, service, intent_id):
    intent = await session.get(ReferenceIntent, intent_id)
    if intent is None or intent.service_id != service:
        raise failure("not_found", "引用变更不存在", 404)
    return intent


class ReferenceChanges:
    def __init__(self, database):
        self.database = database

    async def replay(self, *, authority):
        """A lost acknowledgement may be retrieved without accepting another mutation."""
        async with self.database.sessions() as session:
            session.info["owner_user_id"] = authority.owner_id
            intent = await session.scalar(
                select(ReferenceIntent).where(
                    ReferenceIntent.service_id == authority.caller,
                    ReferenceIntent.request_id == authority.request_id,
                )
            )
            if intent is None:
                return None
            if intent.payload_sha256 != authority.change_sha256:
                raise failure("request_id_conflict", "请求 ID 已用于不同的引用变更")
            return intent.prepared_result

    async def verify_access(self, *, authority, intent_id):
        async with self.database.sessions() as session:
            session.info["owner_user_id"] = authority.owner_id
            intent = await owned_intent(session, authority.caller, intent_id)
            if (intent.request_id, intent.payload_sha256) != (
                authority.request_id,
                authority.change_sha256,
            ):
                raise failure("not_found", "引用变更不存在", 404)

    async def prepare(
        self, *, owner, service, change: PrepareReferenceChange, not_after=None, community=None
    ):
        change = change.model_copy(deep=True)
        change.validate_service(service)
        digest = change_digest(change, community)
        async with self.database.sessions() as session:
            session.info["owner_user_id"] = owner
            await session.execute(text("BEGIN IMMEDIATE"))
            existing = await session.scalar(
                select(ReferenceIntent).where(
                    ReferenceIntent.service_id == service,
                    ReferenceIntent.request_id == change.request_id,
                )
            )
            if existing is not None:
                if existing.payload_sha256 != digest:
                    raise failure("request_id_conflict", "请求 ID 已用于不同的引用变更")
                return existing.prepared_result
            if not_after is not None and time.time() >= not_after:
                raise failure("retention_preparation_expired", "引用准备授权已到期", 401)
            row = await session.scalar(
                select(AssetReferenceSet).where(
                    AssetReferenceSet.service_id == service,
                    AssetReferenceSet.resource_kind == change.resource_kind,
                    AssetReferenceSet.resource_id == change.resource_id,
                )
            )
            file_change = change.resource_kind in VIDEO_FILE_CHANGES
            if row is None:
                if change.expected_resource_revision != -1 and not file_change:
                    raise failure("reference_projection_required", "请先导入或核验已保存资源的引用")
                row = AssetReferenceSet(
                    id=new_id(),
                    owner_user_id=owner,
                    service_id=service,
                    resource_kind=change.resource_kind,
                    resource_id=change.resource_id,
                    resource_revision=-1,
                    revision=0,
                    deleted=False,
                )
                session.add(row)
                await session.flush()
            if row.deleted:
                raise failure("not_found", "源资源已删除", 404)
            if change.expected_resource_revision < row.resource_revision:
                raise failure("resource_revision_conflict", "源资源版本已过期")
            active = await session.scalar(
                select(func.count())
                .select_from(ReferenceIntent)
                .where(
                    ReferenceIntent.reference_set_id == row.id,
                    ReferenceIntent.state == "prepared",
                )
            )
            if active >= 128:
                raise failure("reference_mutations_pending", "请先恢复未完成的引用变更")
            if service in PROJECT_FILE_COLUMNS and change.resource_kind == "project":
                if change.asset_ids:
                    raise failure(
                        f"invalid_{service}_project_reference", "项目范围不能指定素材", 422
                    )
                if change.expected_resource_revision >= 0:
                    await files_for_removal(session, service, change.resource_id)
            requested = set(change.asset_ids)
            await protect_pending_removals(session, requested)
            describe_story = story_metadata(service, change)
            describe_canvas = canvas_metadata(service, change)
            unavailable = set()
            present = set()
            if requested and describe_story:
                candidates = list(
                    await session.scalars(select(VisualAsset).where(VisualAsset.id.in_(requested)))
                )
                present = {asset.id for asset in candidates}
                if present != requested:
                    raise failure("not_found", "部分素材不存在", 404)
                if any(
                    asset.motion_compositor_project_id is not None
                    or asset.video_editor_project_id is not None
                    for asset in candidates
                ):
                    raise failure("story_galgame_asset_scope", "不能引用其他工坊的私有素材", 422)
                if any(asset.project_id is not None for asset in candidates):
                    raise failure("story_visual_asset_scope", "不能引用视觉工坊的私有素材", 422)
                if any(
                    asset.galgame_project_id not in {None, change.resource_id}
                    for asset in candidates
                ):
                    raise failure(
                        "story_galgame_asset_scope", "不能引用其他 Galgame 工程的私有素材", 422
                    )
            elif requested and service == "annotation":
                asset = await session.scalar(
                    select(VisualAsset).where(
                        VisualAsset.id.in_(requested),
                        VisualAsset.project_id.is_(None),
                        VisualAsset.galgame_project_id.is_(None),
                        VisualAsset.video_editor_project_id.is_(None),
                        VisualAsset.motion_compositor_project_id.is_(None),
                    )
                )
                if asset is None or len(requested) != 1:
                    raise failure("not_found", "音频文件不存在", 404)
                if asset.media_kind != "audio":
                    raise failure("invalid_audio", "标注任务只能使用音频文件", 422)
                if asset.byte_size > MAX_AUDIO_BYTES:
                    raise failure("audio_too_large", "音频不能超过 100 MiB", 413)
                present = {asset.id}
            elif requested and service == "presentation":
                present = set(
                    await session.scalars(
                        select(VisualAsset.id).where(
                            VisualAsset.id.in_(requested),
                            VisualAsset.project_id.is_(None),
                            VisualAsset.galgame_project_id.is_(None),
                            VisualAsset.video_editor_project_id.is_(None),
                            VisualAsset.motion_compositor_project_id.is_(None),
                            VisualAsset.media_kind.in_(("image", "audio", "video")),
                        )
                    )
                )
            elif requested and describe_canvas:
                present, known = await canvas_files(session, row, change)
                unavailable = requested - present
                forbidden = unavailable - set(change.carried_asset_ids)
                if forbidden & known:
                    raise failure("canvas_asset_scope", "节点素材不属于当前项目", 422)
                if forbidden:
                    raise failure("not_found", "部分素材不存在", 404)
            elif requested:
                present = set(
                    await session.scalars(
                        select(VisualAsset.id).where(VisualAsset.id.in_(requested))
                    )
                )
            if not describe_canvas and present != requested:
                raise failure("not_found", "部分素材不存在", 404)
            if file_change:
                handler = galgame_file_changes if service == "galgame" else video_file_changes
                present.add(await handler.prepare(session, owner, row, change))
            identifier = new_id()
            row.revision += 1
            result = {"intent_id": identifier, "state": "prepared", "revision": row.revision}
            if file_change:
                result.update(handler.command(change))
            if describe_canvas:
                result["unavailable_asset_ids"] = sorted(unavailable)
            if community is not None or describe_story or describe_canvas:
                assets = await session.scalars(
                    select(VisualAsset).where(
                        VisualAsset.id.in_(set(change.metadata_asset_ids) - unavailable)
                    )
                )
                result["metadata"] = [
                    AssetDescription.model_validate(asset, from_attributes=True).model_dump()
                    for asset in sorted(assets, key=lambda asset: asset.id)
                ]
            intent = ReferenceIntent(
                id=identifier,
                owner_user_id=owner,
                service_id=service,
                request_id=change.request_id,
                reference_set_id=row.id,
                expected_resource_revision=change.expected_resource_revision,
                payload_sha256=digest,
                prepared_result=result,
            )
            session.add(intent)
            await session.flush()
            session.add_all(
                [
                    PreparedAssetPin(intent_id=identifier, asset_id=asset_id, owner_user_id=owner)
                    for asset_id in sorted(present)
                ]
            )
            await session.commit()
            return result

    async def status(self, *, owner, service, intent_id):
        async with self.database.sessions() as session:
            session.info["owner_user_id"] = owner
            intent = await owned_intent(session, service, intent_id)
            return {
                "intent_id": intent.id,
                "state": intent.state,
                "expected_resource_revision": intent.expected_resource_revision,
                "committed_revision": intent.committed_revision,
            }

    async def commit(self, *, owner, service, intent_id, resource_revision, deleted=False):
        """The source commits document + receipt atomically before this call."""
        if type(resource_revision) is not int or type(deleted) is not bool:
            raise failure("invalid_resource_revision", "源资源版本无效", 422)
        async with self.database.sessions() as session:
            session.info["owner_user_id"] = owner
            await session.execute(text("BEGIN IMMEDIATE"))
            intent = await owned_intent(session, service, intent_id)
            if intent.committed_result is not None:
                if (intent.committed_revision, intent.committed_deleted) != (
                    resource_revision,
                    deleted,
                ):
                    raise failure("reference_receipt_conflict", "引用提交回执与原结果不一致")
                return intent.committed_result
            if intent.state == "aborted":
                raise failure("reference_intent_aborted", "已确认未提交的引用变更不能改为成功")
            if resource_revision <= intent.expected_resource_revision:
                raise failure("invalid_resource_revision", "源提交必须推进资源版本", 422)
            row = await session.get(AssetReferenceSet, intent.reference_set_id)
            if (
                service == "galgame"
                and row.resource_kind == "story"
                and (deleted or resource_revision != intent.expected_resource_revision + 1)
            ):
                raise failure("invalid_resource_revision", "故事引用回执必须与保存版本一致", 422)
            scoped_project = service in PROJECT_FILE_COLUMNS and row.resource_kind == "project"
            if scoped_project and (
                deleted != (intent.expected_resource_revision >= 0)
                or resource_revision != intent.expected_resource_revision + 1
            ):
                raise failure("invalid_resource_revision", "项目结果与原操作不符", 422)
            desired = set(
                (
                    await session.scalars(
                        select(PreparedAssetPin.asset_id).where(
                            PreparedAssetPin.intent_id == intent.id,
                        )
                    )
                ).all()
            )
            file_change = row.resource_kind in VIDEO_FILE_CHANGES
            if file_change:
                desired.clear()
            if deleted and desired:
                raise failure("invalid_deleted_reference", "删除资源的最终引用必须为空", 422)
            if intent.state == "superseded" and resource_revision >= row.resource_revision:
                raise failure("source_revision_conflict", "被取代的变更不能声明新的源提交")
            if row.resource_revision > resource_revision or intent.state == "superseded":
                state = "superseded"
            else:
                current = set(
                    (
                        await session.scalars(
                            select(AssetReferencePin.asset_id).where(
                                AssetReferencePin.reference_set_id == row.id,
                            )
                        )
                    ).all()
                )
                if row.resource_revision == resource_revision and (
                    current != desired or row.deleted != deleted
                ):
                    raise failure("source_revision_conflict", "同一源资源版本不能具有不同的引用")
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
                        for asset_id in sorted(desired)
                    ]
                )
                if file_change:
                    handler = galgame_file_changes if service == "galgame" else video_file_changes
                    await handler.commit(session, owner, row, intent, resource_revision, deleted)
                if scoped_project and deleted:
                    await remove_files(session, service, row.resource_id)
                row.resource_revision = resource_revision
                row.deleted = deleted
                state = "committed"
                # A newer committed snapshot supersedes older protection.
                # Source receipts still determine whether those older writes committed.
                older = list(
                    (
                        await session.scalars(
                            select(ReferenceIntent).where(
                                ReferenceIntent.reference_set_id == row.id,
                                ReferenceIntent.state == "prepared",
                                (ReferenceIntent.expected_resource_revision < resource_revision)
                                | deleted,
                            )
                        )
                    ).all()
                )
                for pending in older:
                    if pending.id != intent.id:
                        pending.state = "superseded"
                    await session.execute(
                        delete(PreparedAssetPin).where(
                            PreparedAssetPin.intent_id == pending.id,
                        )
                    )
            await session.execute(
                delete(PreparedAssetPin).where(PreparedAssetPin.intent_id == intent.id)
            )
            row.revision += 1
            intent.state = state
            intent.committed_revision = resource_revision
            intent.committed_deleted = deleted
            result = {
                "intent_id": intent.id,
                "state": state,
                "revision": row.revision,
                "resource_revision": row.resource_revision,
            }
            intent.committed_result = result
            await session.commit()
            return result

    async def abort(self, *, owner, service, intent_id):
        """Call only after the source durably proves its mutation did not commit."""
        async with self.database.sessions() as session:
            session.info["owner_user_id"] = owner
            await session.execute(text("BEGIN IMMEDIATE"))
            intent = await owned_intent(session, service, intent_id)
            if intent.aborted_result is not None:
                return intent.aborted_result
            if intent.committed_result is not None:
                raise failure("reference_intent_committed", "已提交的引用不能按未提交恢复")
            row = await session.get(AssetReferenceSet, intent.reference_set_id)
            await session.execute(
                delete(PreparedAssetPin).where(PreparedAssetPin.intent_id == intent.id)
            )
            if intent.state != "superseded":
                intent.state = "aborted"
            row.revision += 1
            result = {"intent_id": intent.id, "state": intent.state, "revision": row.revision}
            intent.aborted_result = result
            await session.commit()
            return result

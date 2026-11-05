"""Persist reference preparation and deliver the owner's durable source outcome."""

from dataclasses import dataclass, field

from pydantic import ValidationError
from sqlalchemy import select, text, update

from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.contracts.asset_library.retention_authority import change_digest, verify_retention
from studio.contracts.thought_workshop.thought_assets import AssetDescription
from studio.runtime.http.capability_client import CapabilityDenied
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


@dataclass(frozen=True)
class PreparedReferences:
    owner: str
    request_id: str
    change_sha256: str
    asset_intent_id: str
    metadata: tuple[AssetDescription, ...] = ()
    unavailable_asset_ids: frozenset[str] = frozenset()
    authority: str = field(default="", repr=False)


class ReferenceMutations:
    def __init__(self, sessions, client, *, service, model, public_key, failure):
        self.sessions = sessions
        self.client = client
        self.service = service
        self.model = model
        self.public_key = public_key
        self.failure = failure

    async def prepare(
        self,
        *,
        owner,
        assertion,
        source_method,
        source_path,
        change: PrepareReferenceChange,
        community=None,
        generation_plan_sha256=None,
    ):
        change.validate_service(self.service)
        fingerprint = change_digest(change, community)
        # The narrow retention token grants only this exact change. It is persisted
        # before any prepare is sent, and cannot execute or read another resource.
        if generation_plan_sha256 is not None:
            authority = await self.client.authorize_generation(generation_plan_sha256, change)
        else:
            authority = await self.client.authorize(
                assertion=assertion,
                source_method=source_method,
                source_path=source_path,
                change=change,
                **({"community": community} if community is not None else {}),
            )
        grant = verify_retention(authority, public_key=self.public_key)
        if (
            grant.owner_id != owner
            or grant.caller != self.service
            or grant.community != community
            or not grant.matches(change)
        ):
            raise self.failure("引用授权与当前修改不匹配", 403, "retention_owner_mismatch")
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(self.model, (owner, change.request_id))
            if row is not None:
                if row.change_sha256 != fingerprint:
                    raise self.failure("引用请求ID已用于不同的修改", 409, "request_id_conflict")
                authority = row.authority
                if row.state not in {"preparing", "prepared"}:
                    raise self.failure("引用修改结果已经确定", 409, "retention_outcome_conflict")
                if row.asset_intent_id and change.metadata_asset_ids is None:
                    return PreparedReferences(
                        owner, row.request_id, fingerprint, row.asset_intent_id
                    )
            else:
                session.add(
                    self.model(
                        owner_user_id=owner,
                        request_id=change.request_id,
                        change_sha256=fingerprint,
                        change=change.model_dump(mode="json"),
                        authority=authority,
                    )
                )
            await session.commit()
        result = await self.client.prepare(authority=authority, change=change)
        identity = result.get("intent_id")
        if (
            not isinstance(identity, str)
            or not 1 <= len(identity) <= 128
            or result.get("state") != "prepared"
        ):
            raise self.failure("素材引用准备未确认", 503, "retention_unconfirmed")
        metadata = ()
        unavailable = frozenset()
        if change.metadata_asset_ids is not None:
            try:
                metadata = tuple(
                    AssetDescription.model_validate(value) for value in result["metadata"]
                )
                if change.carried_asset_ids is not None:
                    ids = result["unavailable_asset_ids"]
                    if not isinstance(ids, list) or not all(
                        isinstance(value, str) for value in ids
                    ):
                        raise ValueError("invalid unavailable asset receipt")
                    unavailable = frozenset(ids)
                    if len(unavailable) != len(ids) or not unavailable.issubset(
                        change.carried_asset_ids
                    ):
                        raise ValueError("unexpected unavailable asset")
                expected = sorted(set(change.metadata_asset_ids) - unavailable)
                if [asset.id for asset in metadata] != expected:
                    raise ValueError("metadata receipt mismatch")
            except (KeyError, ValueError, TypeError, ValidationError):
                raise self.failure("素材元数据回执未确认", 503, "retention_unconfirmed") from None
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(
                update(self.model)
                .where(
                    self.model.owner_user_id == owner,
                    self.model.request_id == change.request_id,
                    self.model.change_sha256 == fingerprint,
                    self.model.state == "preparing",
                )
                .values(asset_intent_id=identity, state="prepared", updated_at=utc_now())
            )
            await session.commit()
        return PreparedReferences(
            owner, change.request_id, fingerprint, identity, metadata, unavailable, authority
        )

    async def record(self, source_session, prepared, *, resource_revision, deleted=False):
        if source_session.info.get("owner_user_id") != prepared.owner:
            raise self.failure("引用结果缺少匹配的账号上下文", 403, "retention_owner_mismatch")
        row = await source_session.get(self.model, (prepared.owner, prepared.request_id))
        if row is None or (row.change_sha256, row.asset_intent_id) != (
            prepared.change_sha256,
            prepared.asset_intent_id,
        ):
            raise self.failure("引用准备不存在", 409, "retention_intent_missing")
        change = PrepareReferenceChange.model_validate(row.change)
        if (
            type(resource_revision) is not int
            or resource_revision <= change.expected_resource_revision
            or type(deleted) is not bool
        ):
            raise ValueError("引用结果必须推进资源版本")
        if deleted and change.asset_ids:
            raise ValueError("永久删除的引用必须为空")
        if row.state == "commit" and (row.resource_revision, row.deleted) == (
            resource_revision,
            deleted,
        ):
            return
        if row.state != "prepared":
            raise self.failure("引用修改结果已经确定", 409, "retention_outcome_conflict")
        row.state, row.resource_revision, row.deleted = "commit", resource_revision, deleted
        row.updated_at = utc_now()
        # Caller commits this outcome with the document/history mutation.
        await source_session.flush()

    async def commit_source(self, session, prepared, apply, record_operation=None):
        try:
            result = await apply()
            if record_operation is not None:
                record_operation(result)
            await self.record(session, prepared, resource_revision=result.revision)
        except BaseException:
            await session.rollback()
            await self.abort_after_rollback(session, prepared)
            raise
        # Once commit starts, only the durable outcome can decide a remote abort.
        await session.commit()
        return result

    async def abandon_preparation(self, source_session, owner, change):
        """Mark an uncertain preparation when the source write has never started."""
        await self.abort_after_rollback(
            source_session,
            PreparedReferences(owner, change.request_id, change_digest(change), ""),
        )

    async def abort_after_rollback(self, source_session, prepared):
        if source_session.info.get("owner_user_id") != prepared.owner:
            raise self.failure("引用结果缺少匹配的账号上下文", 403, "retention_owner_mismatch")
        if source_session.in_transaction():
            raise ValueError("只有确认结束源事务后才能确认引用回滚")
        async with self.sessions(info={"owner_user_id": prepared.owner}) as session:
            await session.execute(
                update(self.model)
                .where(
                    self.model.owner_user_id == prepared.owner,
                    self.model.request_id == prepared.request_id,
                    self.model.change_sha256 == prepared.change_sha256,
                    self.model.state.in_(("preparing", "prepared")),
                )
                .values(state="abort", updated_at=utc_now())
            )
            await session.commit()


class ReferenceDelivery(PollingTaskRunner):
    poll_interval_seconds = 1

    def __init__(self, sessions, client, *, service, model):
        super().__init__()
        self.sessions, self.client = sessions, client
        self.model = model
        self.runner_name = f"{service}-asset-retention"

    async def recover(self):
        # Called once under the service process lock, before serving requests.
        # Old source transactions cannot still commit after that process ended.
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(self.model.owner_user_id, self.model.request_id).where(
                        self.model.state.in_(("preparing", "prepared"))
                    )
                )
            )
        for owner, request_id in pending:
            async with self.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(
                    update(self.model)
                    .where(
                        self.model.request_id == request_id,
                        self.model.state.in_(("preparing", "prepared")),
                    )
                    .values(state="abort", updated_at=utc_now())
                )
                await session.commit()

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(self.model.owner_user_id, self.model.request_id)
                    .where(self.model.state.in_(("commit", "abort")))
                    .order_by(self.model.created_at, self.model.request_id)
                    .limit(100)
                )
            )
        for owner, request_id in pending:
            await self.deliver(owner, request_id)

    async def deliver(self, owner, request_id):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(self.model, (owner, request_id))
            if row is None or row.state not in {"commit", "abort"}:
                return
            authority, state, change, identity = (
                row.authority,
                row.state,
                dict(row.change),
                row.asset_intent_id,
            )
            revision, deleted = row.resource_revision, row.deleted
        if identity is None:
            if state != "abort":
                raise ValueError("源提交没有对应的素材引用准备")
            try:
                result = await self.client.prepare(
                    authority=authority, change=PrepareReferenceChange.model_validate(change)
                )
                identity = result["intent_id"]
            except CapabilityDenied as exc:
                # Assets replays accepted intents before checking current authority.
                # These denials occur after the lookup for an accepted receipt.
                refused = (exc.status, exc.code) in {
                    (404, "not_found"),
                    (409, "reference_projection_required"),
                    (409, "resource_revision_conflict"),
                    (409, "reference_mutations_pending"),
                    (409, "asset_in_use"),
                    (409, "video_project_deletion_pending"),
                    (409, "project_deletion_pending"),
                    (409, "project_references_pending"),
                    (409, "project_conversation_scope"),
                    (409, "visual_upload_pending"),
                    (422, "story_visual_asset_scope"),
                    (422, "story_galgame_asset_scope"),
                    (422, "canvas_asset_scope"),
                }
                if exc.status not in {401, 403} and not refused:
                    raise
                result = {"state": "unprepared"}
                identity = None
        if identity is not None:
            result = (
                await self.client.commit(
                    authority=authority,
                    intent_id=identity,
                    resource_revision=revision,
                    deleted=deleted,
                )
                if state == "commit"
                else await self.client.abort(authority=authority, intent_id=identity)
            )
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(
                update(self.model)
                .where(
                    self.model.request_id == request_id,
                    self.model.state == state,
                )
                .values(
                    state="delivered",
                    asset_intent_id=identity,
                    delivered_result=result,
                    updated_at=utc_now(),
                )
            )
            await session.commit()

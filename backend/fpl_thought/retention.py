"""Persist authorization before remote prepare; finalize only a durable source outcome."""

from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy import select, text, update

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.models import ThoughtHistoryAsset, ThoughtNote, ThoughtNoteHistory
from app.apps.thought_workshop.multitable.models import DataAsset
from app.apps.thought_workshop.schemas.document import file_ids
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied
from fpl_runtime.retention_authority import change_digest, verify_retention
from fpl_runtime.thought_assets import AssetDescription

from .retention_records import ThoughtReferenceMutation


@dataclass(frozen=True)
class PreparedReferences:
    owner: str
    request_id: str
    change_sha256: str
    asset_intent_id: str
    metadata: tuple[AssetDescription, ...] = ()


async def note_pin_ids(session, owner, note_id, prospective=()):
    """Current and historical documents/tables retain their files until permanent purge."""
    note = await session.scalar(
        select(ThoughtNote).where(ThoughtNote.id == note_id, ThoughtNote.owner_user_id == owner)
    )
    if note is None:
        raise ThoughtError("笔记不存在", 404, "not_found")
    current = set(file_ids(note.document)) | set(prospective)
    historical = set(
        await session.scalars(
            select(ThoughtHistoryAsset.asset_id)
            .join(ThoughtNoteHistory, ThoughtNoteHistory.id == ThoughtHistoryAsset.history_id)
            .where(ThoughtNoteHistory.note_id == note_id)
        )
    )
    tables = set(
        await session.scalars(select(DataAsset.asset_id).where(DataAsset.note_id == note_id))
    )
    return current | historical | tables


class ThoughtReferences:
    def __init__(self, sessions, client, *, public_key):
        self.sessions, self.client, self.public_key = sessions, client, public_key

    async def prepare(
        self,
        *,
        owner,
        assertion,
        source_method,
        source_path,
        change: PrepareReferenceChange,
        community=None,
    ):
        change.validate_service("thought")
        fingerprint = change_digest(change, community)
        # The narrow retention token grants only this exact change. It is persisted
        # before any prepare is sent, and cannot execute or read another resource.
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
            or grant.caller != "thought"
            or grant.community != community
            or not grant.matches(change)
        ):
            raise ThoughtError("引用授权与当前修改不匹配", 403, "retention_owner_mismatch")
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(ThoughtReferenceMutation, (owner, change.request_id))
            if row is not None:
                if row.change_sha256 != fingerprint:
                    raise ThoughtError("引用请求ID已用于不同的修改", 409, "request_id_conflict")
                authority = row.authority
                if row.state not in {"preparing", "prepared"}:
                    raise ThoughtError("引用修改结果已经确定", 409, "retention_outcome_conflict")
                if row.asset_intent_id and community is None:
                    return PreparedReferences(
                        owner, row.request_id, fingerprint, row.asset_intent_id
                    )
            else:
                session.add(
                    ThoughtReferenceMutation(
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
            raise ThoughtError("素材引用准备未确认", 503, "retention_unconfirmed")
        metadata = ()
        if community is not None:
            try:
                metadata = tuple(
                    AssetDescription.model_validate(value) for value in result["metadata"]
                )
                if [asset.id for asset in metadata] != change.metadata_asset_ids:
                    raise ValueError("metadata receipt mismatch")
            except (KeyError, ValueError, TypeError, ValidationError):
                raise ThoughtError("素材元数据回执未确认", 503, "retention_unconfirmed") from None
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(
                update(ThoughtReferenceMutation)
                .where(
                    ThoughtReferenceMutation.owner_user_id == owner,
                    ThoughtReferenceMutation.request_id == change.request_id,
                    ThoughtReferenceMutation.change_sha256 == fingerprint,
                    ThoughtReferenceMutation.state == "preparing",
                )
                .values(asset_intent_id=identity, state="prepared", updated_at=utc_now())
            )
            await session.commit()
        return PreparedReferences(owner, change.request_id, fingerprint, identity, metadata)

    async def record(self, source_session, prepared, *, resource_revision, deleted=False):
        if source_session.info.get("owner_user_id") != prepared.owner:
            raise ThoughtError("引用结果缺少匹配的账号上下文", 403, "retention_owner_mismatch")
        row = await source_session.get(
            ThoughtReferenceMutation, (prepared.owner, prepared.request_id)
        )
        if row is None or (row.change_sha256, row.asset_intent_id) != (
            prepared.change_sha256,
            prepared.asset_intent_id,
        ):
            raise ThoughtError("引用准备不存在", 409, "retention_intent_missing")
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
            raise ThoughtError("引用修改结果已经确定", 409, "retention_outcome_conflict")
        row.state, row.resource_revision, row.deleted = "commit", resource_revision, deleted
        row.updated_at = utc_now()
        # Caller commits this outcome with the document/history mutation.
        await source_session.flush()

    async def abort_after_rollback(self, source_session, prepared):
        if source_session.info.get("owner_user_id") != prepared.owner:
            raise ThoughtError("引用结果缺少匹配的账号上下文", 403, "retention_owner_mismatch")
        if source_session.in_transaction():
            raise ValueError("只有确认结束源事务后才能确认引用回滚")
        async with self.sessions(info={"owner_user_id": prepared.owner}) as session:
            await session.execute(
                update(ThoughtReferenceMutation)
                .where(
                    ThoughtReferenceMutation.owner_user_id == prepared.owner,
                    ThoughtReferenceMutation.request_id == prepared.request_id,
                    ThoughtReferenceMutation.change_sha256 == prepared.change_sha256,
                    ThoughtReferenceMutation.state.in_(("preparing", "prepared")),
                )
                .values(state="abort", updated_at=utc_now())
            )
            await session.commit()


class ThoughtReferenceDelivery(PollingTaskRunner):
    runner_name = "thought-asset-retention"
    poll_interval_seconds = 1

    def __init__(self, sessions, client):
        super().__init__()
        self.sessions, self.client = sessions, client

    async def recover(self):
        # Called once under the service process lock, before serving requests.
        # Old source transactions cannot still commit after that process ended.
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(
                        ThoughtReferenceMutation.owner_user_id, ThoughtReferenceMutation.request_id
                    ).where(ThoughtReferenceMutation.state.in_(("preparing", "prepared")))
                )
            )
        for owner, request_id in pending:
            async with self.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(
                    update(ThoughtReferenceMutation)
                    .where(
                        ThoughtReferenceMutation.request_id == request_id,
                        ThoughtReferenceMutation.state.in_(("preparing", "prepared")),
                    )
                    .values(state="abort", updated_at=utc_now())
                )
                await session.commit()

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(
                        ThoughtReferenceMutation.owner_user_id, ThoughtReferenceMutation.request_id
                    )
                    .where(ThoughtReferenceMutation.state.in_(("commit", "abort")))
                    .order_by(
                        ThoughtReferenceMutation.created_at, ThoughtReferenceMutation.request_id
                    )
                    .limit(100)
                )
            )
        for owner, request_id in pending:
            await self.deliver(owner, request_id)

    async def deliver(self, owner, request_id):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(ThoughtReferenceMutation, (owner, request_id))
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
                # Expired/revoked preparation with no replay proves it accepted none.
                if exc.status not in {401, 403}:
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
                update(ThoughtReferenceMutation)
                .where(
                    ThoughtReferenceMutation.request_id == request_id,
                    ThoughtReferenceMutation.state == state,
                )
                .values(
                    state="delivered",
                    asset_intent_id=identity,
                    delivered_result=result,
                    updated_at=utc_now(),
                )
            )
            await session.commit()

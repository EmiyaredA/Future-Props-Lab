"""Feishu steps bind the immutable article, one action receipt and observed remote state."""

import base64
import hashlib
from copy import deepcopy

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.integrations.external.blocks import feishu_tree
from app.integrations.external.catalog import ExternalConnections
from app.integrations.external.contracts import ExternalError, ImageSource, RemoteDocument
from app.integrations.external.feishu_verification import (
    assert_snapshot,
    verify_append,
    verify_delete,
    verify_image,
)
from studio.runtime.time import utc_now

from .external_reads import guarded
from .records import ExternalClosure, ExternalExecution, ExternalStepReceipt


def canonical_tree(tree):
    try:
        ids = [block["block_id"] for block in tree["blocks"]]
        if len(ids) != len(set(ids)) or set(tree) != {"blocks", "root_ids", "images"}:
            raise ValueError("duplicate ids")
        mapping = {identity: str(index) for index, identity in enumerate(ids)}
        blocks = []
        for original in tree["blocks"]:
            block = deepcopy(original)
            block["block_id"] = mapping[block["block_id"]]
            if "children" in block:
                block["children"] = [mapping[id] for id in block["children"]]
            blocks.append(block)
        return {
            "blocks": blocks,
            "root_ids": [mapping[id] for id in tree["root_ids"]],
            "images": {mapping[id]: asset for id, asset in tree["images"].items()},
        }
    except (KeyError, TypeError, ValueError):
        raise ExternalError("同步内容块结构不正确", 422) from None


class ExternalSteps:
    def __init__(self, database, transport=None, *, cipher=None):
        self.cipher = cipher
        self.database, self.transport = database, transport

    async def progress(self, actor, scope, intent_id):
        async with self.database.sessions(info={"owner_user_id": actor.user_id}) as session:
            row = await session.get(ExternalExecution, str(scope.task_id))
            if row is None:
                return {"status": "missing"}
            if row.intent_id != str(intent_id) or row.input_sha256 != scope.input_sha256:
                raise ExternalError("同步任务授权不一致", 409, "task_authority_changed")
            return {"status": row.status, "checkpoint": row.checkpoint}

    async def step_proof(self, actor, scope, intent_id, body):
        async with self.database.sessions(info={"owner_user_id": actor.user_id}) as session:
            task = await session.get(ExternalExecution, str(scope.task_id))
            if task is None:
                return {"status": "missing"}
            if task.intent_id != str(intent_id) or task.input_sha256 != scope.input_sha256:
                raise ExternalError("同步任务授权不一致", 409, "task_authority_changed")
            receipt = await session.get(ExternalStepReceipt, str(body.step_id))
            if receipt is None or receipt.task_id != task.task_id:
                return {"status": "missing"}
            if receipt.fingerprint != body.request_sha256:
                raise ExternalError("同步步骤摘要不一致", 409, "step_conflict")
            return {
                "status": receipt.status,
                "result": receipt.result if receipt.status == "confirmed" else {},
            }

    async def snapshot(self, actor, scope, intent_id, body):
        if body.task_payload.fingerprint() != scope.input_sha256:
            raise ExternalError("同步正文摘要不一致", 403, "scope_mismatch")
        initial = body.task_payload.remote
        try:
            remote = RemoteDocument(
                initial["document_id"],
                initial["title"],
                initial["revision"],
                initial["blocks"],
                initial["root_ids"],
            )
            if remote.document_id != scope.document_id or remote.snapshot() != initial:
                raise ValueError("remote snapshot")
            tree = feishu_tree(body.task_payload.content["nodes"])
        except (KeyError, TypeError, ValueError):
            raise ExternalError("同步预览格式不正确", 422) from None
        if set(tree["images"].values()) != {asset.id for asset in body.task_payload.asset_manifest}:
            raise ExternalError("同步图片清单不正确", 422)
        async with self.database.sessions(info={"owner_user_id": actor.user_id}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            if await session.get(ExternalClosure, str(scope.task_id)) is not None:
                raise ExternalError("同步任务已经明确结束", 409, "task_closed")
            row = await session.get(ExternalExecution, str(scope.task_id))
            if row is None:
                row = ExternalExecution(
                    task_id=str(scope.task_id),
                    owner_user_id=actor.user_id,
                    intent_id=str(intent_id),
                    input_sha256=scope.input_sha256,
                    connection_id=scope.connection_id,
                    connection_revision=scope.connection_revision,
                    document_id=scope.document_id,
                    payload={
                        "version": 1,
                        "note_id": scope.source_resource_id,
                        "task": body.task_payload.model_dump(mode="json"),
                    },
                    checkpoint={
                        "remote": initial,
                        "appended": False,
                        "images": {},
                        "tokens": {},
                        "replaced": [],
                        "deleted": False,
                    },
                )
                session.add(row)
                try:
                    await session.commit()
                except IntegrityError:
                    raise ExternalError("目标文档有未结束同步", 409, "target_busy") from None
            if (
                row.intent_id != str(intent_id)
                or row.input_sha256 != scope.input_sha256
                or row.payload.get("note_id") != scope.source_resource_id
            ):
                raise ExternalError("同步任务授权不一致", 409, "task_authority_changed")
            return deepcopy(row.checkpoint), row.status, tree

    async def replay_or_claim(self, actor, scope, body, checkpoint):
        async with self.database.sessions(info={"owner_user_id": actor.user_id}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(ExternalExecution, str(scope.task_id))
            prior = await session.scalar(
                select(ExternalStepReceipt).where(
                    ExternalStepReceipt.task_id == str(scope.task_id),
                    ExternalStepReceipt.action_key == body.action_key,
                )
            )
            if prior is not None:
                if prior.id != str(body.step_id) or prior.fingerprint != body.fingerprint():
                    raise ExternalError("该同步动作已有其他回执", 409, "step_conflict")
                if prior.status != "confirmed":
                    raise ExternalError("同步动作结果未知，不会重复执行", 409, "uncertain_write")
                return deepcopy(prior.result)
            if row.status != "active" or row.checkpoint != checkpoint:
                raise ExternalError("同步任务已变化或需要核对", 409, "uncertain_write")
            pending = await session.scalar(
                select(ExternalStepReceipt.id).where(
                    ExternalStepReceipt.task_id == row.task_id,
                    ExternalStepReceipt.status != "confirmed",
                )
            )
            if pending:
                raise ExternalError("先前同步步骤结果未知", 409, "uncertain_write")
            await ExternalConnections(session, actor.user_id, cipher=self.cipher).require_enabled(
                scope.connection_id, expected_revision=scope.connection_revision
            )
            session.add(
                ExternalStepReceipt(
                    id=str(body.step_id),
                    owner_user_id=actor.user_id,
                    task_id=row.task_id,
                    action_key=body.action_key,
                    fingerprint=body.fingerprint(),
                    status="running",
                )
            )
            await session.commit()
        return None

    async def mark_unknown(self, owner, task_id, step_id):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            step = await session.get(ExternalStepReceipt, str(step_id))
            task = await session.get(ExternalExecution, str(task_id))
            if step and step.status == "running":
                step.status, step.updated_at = "unknown", utc_now()
                if task.status == "active":
                    task.status = "unknown"
                await session.commit()

    async def finish(self, owner, task_id, step_id, result, checkpoint, *, complete):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            task = await session.get(ExternalExecution, str(task_id))
            step = await session.get(ExternalStepReceipt, str(step_id))
            if task.status != "active" or step.status != "running":
                raise ExternalError("同步步骤已经停止", 409, "uncertain_write")
            step.status, step.result, step.updated_at = "confirmed", result, utc_now()
            task.checkpoint = checkpoint
            if complete:
                task.status = "closed"
            await session.commit()

    async def execute(self, actor, scope, intent_id, body, check):
        authorization_check = check

        async def current():
            await authorization_check()
            async with self.database.sessions(info={"owner_user_id": actor.user_id}) as session:
                await ExternalConnections(
                    session, actor.user_id, cipher=self.cipher
                ).require_enabled(scope.connection_id, expected_revision=scope.connection_revision)

        check = current
        await check()
        checkpoint, status, tree = await self.snapshot(actor, scope, intent_id, body)
        # A confirmed receipt can be read even after all planned writes are complete.
        async with self.database.sessions(info={"owner_user_id": actor.user_id}) as session:
            prior = await session.get(ExternalStepReceipt, str(body.step_id))
            if prior is not None:
                if (
                    prior.task_id != str(scope.task_id)
                    or prior.fingerprint != body.fingerprint()
                    or prior.status != "confirmed"
                ):
                    raise ExternalError("同步步骤结果未知或内容不一致", 409, "uncertain_write")
                return deepcopy(prior.result)
        if status != "active":
            raise ExternalError("同步任务需要核对或已经结束", 409, "uncertain_write")
        self.validate_step(body, checkpoint, tree)
        async with self.database.sessions(info={"owner_user_id": actor.user_id}) as session:
            client = await ExternalConnections(
                session, actor.user_id, self.transport, cipher=self.cipher
            ).client(scope.connection_id, expected_revision=scope.connection_revision)
        before = checkpoint["remote"]
        remote = await guarded(lambda: client.read(scope.document_id), check)
        assert_snapshot(remote, before)
        if not await guarded(lambda: client.can_write(scope.document_id), check):
            raise ExternalError("目标文档不可编辑", 403)
        await check()
        replay = await self.replay_or_claim(actor, scope, body, checkpoint)
        if replay is not None:
            return replay
        try:
            result, after = await guarded(
                lambda: self.perform(client, scope, body, checkpoint), check
            )
            if body.kind == "append":
                checkpoint.update(
                    appended=True, images=verify_append(before, after, result, body.tree)
                )
            elif body.kind == "upload_image":
                assert_snapshot(after, before)
                checkpoint["tokens"][body.block_id] = result["file_token"]
            elif body.kind == "replace_image":
                verify_image(before, after, body.block_id, body.token)
                checkpoint["replaced"].append(body.block_id)
            else:
                verify_delete(before, after, body.task_payload.remote["root_ids"])
                checkpoint["deleted"] = True
            if body.kind != "upload_image":
                if result.get("document_revision_id") != after.revision:
                    raise ExternalError("同步写入后的远端版本发生变化", 409, "uncertain_write")
                checkpoint["remote"] = after.snapshot()
            complete = (
                checkpoint["appended"]
                and set(checkpoint["replaced"]) == set(checkpoint["images"])
                and (checkpoint["deleted"] or not body.task_payload.remote["root_ids"])
            )
            await self.finish(
                actor.user_id, scope.task_id, body.step_id, result, checkpoint, complete=complete
            )
            return result
        except BaseException:
            # Even cancellation and a lost local commit reply never cause another write.
            await self.mark_unknown(actor.user_id, scope.task_id, body.step_id)
            raise

    @staticmethod
    def validate_step(body, checkpoint, tree):
        if body.kind == "append":
            valid = (
                not checkpoint["appended"]
                and canonical_tree(body.tree) == canonical_tree(tree)
                and body.revision == checkpoint["remote"]["revision"]
            )
        elif body.kind in {"upload_image", "replace_image"}:
            valid = checkpoint["appended"] and body.block_id in checkpoint["images"]
            if body.kind == "replace_image":
                valid = (
                    valid
                    and body.block_id in checkpoint["tokens"]
                    and body.token == checkpoint["tokens"][body.block_id]
                    and body.revision == checkpoint["remote"]["revision"]
                )
            else:
                valid = valid and body.block_id not in checkpoint["tokens"]
                asset = next(
                    (
                        asset
                        for asset in body.task_payload.asset_manifest
                        if asset.id == checkpoint["images"].get(body.block_id)
                    ),
                    None,
                )
                try:
                    data = base64.b64decode(body.image_base64, validate=True)
                except ValueError:
                    data = b""
                valid = (
                    valid
                    and asset is not None
                    and len(data) == asset.byte_size
                    and hashlib.sha256(data).hexdigest() == asset.content_sha
                )
        else:
            valid = (
                checkpoint["appended"]
                and not checkpoint["deleted"]
                and set(checkpoint["replaced"]) == set(checkpoint["images"])
                and body.count == len(body.task_payload.remote["root_ids"])
                and checkpoint["remote"]["root_ids"][: body.count]
                == body.task_payload.remote["root_ids"]
                and body.revision == checkpoint["remote"]["revision"]
            )
        if not valid:
            raise ExternalError("同步步骤不符合已确认的正文与远端状态", 409, "step_scope_mismatch")

    @staticmethod
    async def perform(client, scope, body, checkpoint):
        document = scope.document_id
        if body.kind == "append":
            result = await client.append(document, body.tree, body.revision, str(body.step_id))
        elif body.kind == "upload_image":
            asset = next(
                asset
                for asset in body.task_payload.asset_manifest
                if asset.id == checkpoint["images"][body.block_id]
            )
            data = base64.b64decode(body.image_base64, validate=True)
            token = await client.upload_image(
                document, body.block_id, ImageSource(asset.filename, asset.mime, data)
            )
            result = {"file_token": token}
        elif body.kind == "replace_image":
            result = await client.replace_image(
                document, body.block_id, body.token, body.revision, str(body.step_id)
            )
        else:
            result = await client.delete_prefix(
                document, body.count, body.revision, str(body.step_id)
            )
        return result, await client.read(document)

    async def close(self, owner, body):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(ExternalExecution, str(body.task_id))
            closure = await session.get(ExternalClosure, str(body.task_id))
            if closure is not None:
                if closure.note_id != body.note_id:
                    raise ExternalError("任务归属不一致", 404, "not_found")
                return {"closed": True}
            if row is not None:
                if row.payload.get("note_id") != body.note_id:
                    raise ExternalError("同步任务不属于这篇文章", 404, "not_found")
                pending = await session.scalar(
                    select(ExternalStepReceipt.id).where(
                        ExternalStepReceipt.task_id == row.task_id,
                        ExternalStepReceipt.status == "running",
                    )
                )
                if pending:
                    raise ExternalError("同步步骤尚在执行，请稍后核对", 409, "task_running")
                row.status = "closed"
            session.add(
                ExternalClosure(
                    task_id=str(body.task_id), owner_user_id=owner, note_id=body.note_id
                )
            )
            await session.commit()
        return {"closed": True}

    async def recover(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            steps = list(
                await session.scalars(
                    select(ExternalStepReceipt).where(ExternalStepReceipt.status == "running")
                )
            )
        for step in steps:
            await self.mark_unknown(step.owner_user_id, step.task_id, step.id)

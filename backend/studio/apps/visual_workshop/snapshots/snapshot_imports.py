"""Import a validated Visual ZIP through Assets staging and durable delivery."""

import re
from uuid import UUID

import httpx
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError

from studio.apps.asset_library.clients.archive_delivery import FileBatchDelivery, reserve_import
from studio.apps.asset_library.clients.archive_transfer import (
    HashingUpload,
    SnapshotFileDescription,
    chunks,
)
from studio.apps.visual_workshop.snapshots.snapshot_graph import SnapshotResult, SnapshotValues
from studio.apps.visual_workshop.storage.service_models import VisualSnapshotImportBatch
from studio.contracts.asset_library.descriptions import ID
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.thought_workshop.thought_archives import ArchiveBatchKey, ArchiveFileKey
from studio.contracts.visual_workshop.visual_snapshot import (
    IMPORT,
    MODEL_RESOLVE_PURPOSE,
    ModelIdentity,
    SnapshotModelResolution,
    VisualArchiveFolder,
    VisualArchiveManifest,
)
from studio.runtime.files.project_archives import ProjectSnapshotError, stage_project_snapshot
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now

RESOLVED_MODELS = TypeAdapter(dict[str, str])


class SnapshotDelivery(FileBatchDelivery):
    runner_name = "visual-archive-delivery"
    records = VisualSnapshotImportBatch
    result_model = SnapshotResult
    retry_interrupted = False
    pending_error = staticmethod(lambda: ProjectSnapshotError("视觉项目快照尚未结算", status=503))

    async def complete(self, owner, batch_id, state, result):
        if state == "abort":
            await super().complete(owner, batch_id, state, result)
            return
        graph = SnapshotResult.model_validate(result)
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            batch = await session.get(self.records, (owner, batch_id))
            if batch.state == "published":
                return
            if batch.state != "commit" or batch.result != result:
                raise ValueError("视觉项目快照源决议已变化")
            await graph.write(session, owner)
            batch.state, batch.updated_at = "published", utc_now()
            await session.commit()


class SnapshotImports:
    def __init__(self, state, archive, delivery):
        self.state, self.archive, self.delivery = state, archive, delivery

    async def run(self, session, owner, upload, assertion):
        try:
            self.state.snapshot_settings.staging(0)
        except BaseException:
            await upload.close()
            raise
        incoming = HashingUpload(upload)
        staged = await stage_project_snapshot(
            self.state.snapshot_settings, incoming, expected_application="visual-workshop"
        )
        try:
            values = SnapshotValues(staged)
            digest = incoming.digest.hexdigest()
            batch_id, previous = await reserve_import(session, self.delivery.records, owner, digest)
            if previous == "staging":
                raise ProjectSnapshotError("同一视觉项目快照正在导入", status=503)
            if previous != "commit":
                key = ArchiveBatchKey(batch_id=batch_id, source_sha256=digest)
                await self.prepare(session, owner, key, values, staged, assertion)
            try:
                return (await self.delivery.deliver(owner, batch_id)).public
            except (CapabilityDenied, CapabilityUnavailable) as exc:
                raise ProjectSnapshotError("项目已保存，正在恢复素材结算", status=503) from exc
        finally:
            staged.cleanup()

    async def prepare(self, session, owner, key, values, staged, assertion):
        project = UUID(hex=key.batch_id)
        try:
            models = await self.resolve_models(values, assertion)
            members, identities = await self.stage(owner, key, values, staged, assertion)
            graph, canvas, acceptance = values.build(owner, str(project), identities, models)
            manifest = archive_manifest(project, values, members, identities, canvas, acceptance)
            await validate_local_graph(session, graph, owner)
            await self.archive.seal(owner, key, manifest, assertion)
            active = await self.state.snapshot_authorization.status(
                assertion=assertion, method="POST", path=IMPORT
            )
            if active is not True:
                raise ProjectSnapshotError(
                    "项目快照授权已结束", status=401 if active is False else 503
                )
            await session.execute(text("BEGIN IMMEDIATE"))
            changed = await session.execute(
                update(self.delivery.records)
                .where(
                    self.delivery.records.owner_user_id == owner,
                    self.delivery.records.batch_id == key.batch_id,
                    self.delivery.records.state == "staging",
                )
                .values(
                    manifest_sha256=manifest.fingerprint,
                    result=graph.model_dump(mode="json"),
                    state="commit",
                    updated_at=utc_now(),
                )
            )
            if changed.rowcount != 1:
                raise ProjectSnapshotError("视觉项目快照状态已变化", status=409)
            await session.commit()
        except BaseException as exc:
            await session.rollback()
            await self.delivery.release(owner, key.batch_id, retry=False)
            if isinstance(exc, CapabilityDenied):
                raise ProjectSnapshotError("项目快照素材未获准保存", status=exc.status) from exc
            if isinstance(exc, CapabilityUnavailable):
                raise ProjectSnapshotError("项目快照素材暂不可保存", status=503) from exc
            raise

    async def resolve_models(self, values, assertion):
        if not isinstance(values.references, dict):
            return {}
        references = {}
        used = {
            node.generation_draft.model_id
            for node in values.canvas.nodes
            if getattr(node, "generation_draft", None) is not None
            and node.generation_draft.model_id
        }
        for identity in sorted(used & values.references.keys()):
            try:
                references[identity] = ModelIdentity.model_validate(values.references[identity])
            except ValidationError:
                continue
        if not references:
            return {}
        query = SnapshotModelResolution(references=references)
        peer = self.state.capabilities
        grant = RequestGrant(
            "visual", MODEL_RESOLVE_PURPOSE, "POST", IMPORT, "models", "POST", query.path
        )
        try:
            token = await peer.authorize_request(assertion, grant)
            response = await peer.client.post(
                "http://models:8080" + query.path, headers={HEADER: token}, json=query.model_dump()
            )
            if response.status_code in {401, 403}:
                raise CapabilityDenied(response.status_code)
            response.raise_for_status()
            result = RESOLVED_MODELS.validate_json(response.content)
            if not set(result).issubset(references) or not all(
                re.fullmatch(ID, item) for item in result.values()
            ):
                raise ValueError("resolved snapshot models are outside the request")
            return result
        except (httpx.HTTPError, ValueError) as exc:
            raise CapabilityUnavailable("视觉项目快照模型目录暂不可用") from exc

    async def stage(self, owner, key, values, staged, assertion):
        manifest = {item.source_id: item for item in staged.manifest.assets}
        members, identities = [], {}
        for ordinal, item in enumerate(values.assets):
            source_id = item["id"]
            source = manifest[source_id]
            if source.byte_size != item["byte_size"]:
                raise ProjectSnapshotError("快照素材记录与清单长度不一致")
            try:
                description = SnapshotFileDescription(
                    item["original_filename"],
                    item["mime_type"],
                    item["byte_size"],
                    source.sha256,
                    item["display_name"],
                )
            except ValueError as exc:
                raise ProjectSnapshotError("视觉项目快照素材描述无效") from exc
            asset = await self.archive.stage(
                owner, key, ordinal, description, chunks(staged.asset_path(source_id)), assertion
            )
            if (
                asset.original_filename != description.filename
                or asset.display_name != description.display_name
                or asset.media_kind != item["media_kind"]
                or asset.byte_size != source.byte_size
            ):
                raise ProjectSnapshotError("视觉项目快照素材类型或名称已变化")
            identities[source_id] = asset.id
            members.append(
                ArchiveFileKey(ordinal=ordinal, descriptor_sha256=description.fingerprint)
            )
        return members, identities


def archive_manifest(project, values, files, identities, canvas, acceptance):
    folder_ids = {item["id"]: new_id() for item in values.folders}
    ordinals = {identities[item["id"]]: index for index, item in enumerate(values.assets)}
    if not (canvas | acceptance).issubset(ordinals):
        raise ProjectSnapshotError("视觉项目快照缺少已引用的素材")
    return VisualArchiveManifest(
        project_id=project,
        files=files,
        folders=[
            VisualArchiveFolder(
                id=folder_ids[item["id"]],
                parent_id=folder_ids.get(item["parent_id"]),
                name=item["name"],
            )
            for item in values.folders
        ],
        file_folders=[folder_ids.get(item.get("folder_id")) for item in values.assets],
        canvas_ordinals=sorted(ordinals[identity] for identity in canvas),
        acceptance_ordinals=sorted(ordinals[identity] for identity in acceptance),
    )


async def validate_local_graph(session, graph, owner):
    await session.execute(text("BEGIN IMMEDIATE"))
    try:
        await graph.write(session, owner)
    except IntegrityError as exc:
        raise ProjectSnapshotError("视觉项目快照包含冲突的记录") from exc
    finally:
        await session.rollback()

"""Own presentation import decisions and materialize documents after Assets settlement."""

import hashlib

from sqlalchemy import text, update

from studio.apps.asset_library.clients.archive_delivery import FileBatchDelivery, reserve_import
from studio.apps.presentation_workshop.asset_references import document_references, validate_assets
from studio.apps.presentation_workshop.exchange.transfers import remap_document
from studio.apps.presentation_workshop.project_errors import PresentationError
from studio.apps.presentation_workshop.schemas.document import (
    PresentationProjectIn,
    PresentationProjectOut,
)
from studio.apps.presentation_workshop.storage.models import PresentationProject
from studio.apps.presentation_workshop.storage.service_models import PresentationImportBatch
from studio.contracts.presentation_workshop.presentation_archives import PresentationManifest
from studio.contracts.thought_workshop.thought_archives import ArchiveBatchKey, ArchiveFileKey
from studio.runtime.files.signed_payloads import ModelOutputDescription
from studio.runtime.files.svg import normalize_svg
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


class ImportDelivery(FileBatchDelivery):
    runner_name = "presentation-archive-delivery"
    records = PresentationImportBatch
    result_model = PresentationProjectOut
    retry_interrupted = False
    pending_error = staticmethod(
        lambda: PresentationError("归档批次尚未提交", 409, "archive_pending")
    )

    async def complete(self, owner, batch_id, state, result):
        if state == "abort":
            await super().complete(owner, batch_id, state, result)
            return
        project = PresentationProjectOut.model_validate(result)
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            batch = await session.get(self.records, (owner, batch_id))
            if batch.state == "published":
                return
            if batch.state != "commit" or batch.result != result:
                raise ValueError("归档源结果已变化")
            session.add(PresentationProject(**project.model_dump(), owner_user_id=owner))
            batch.state, batch.updated_at = "published", utc_now()
            await session.commit()


def payload(title, document, ids):
    return PresentationProjectIn(title=title, document=remap_document(document, ids))


class Imports:
    def __init__(self, connection, archive, delivery):
        self.connection, self.archive, self.delivery = connection, archive, delivery

    async def __call__(self, projects, title, document, files, source_sha256):
        if not files:
            return await projects.create(payload(title, document, {}))
        if self.archive is None:
            raise PresentationError("演示归档暂不可用", 503, "archive_unavailable")
        session, owner = projects.session, projects.owner_user_id
        batch_id, previous = await reserve_import(
            session, PresentationImportBatch, owner, source_sha256
        )
        if previous == "staging":
            raise PresentationError("同一文稿已在导入", 409, "archive_pending")
        if previous == "commit":
            return await self.deliver(owner, batch_id)
        key = ArchiveBatchKey(batch_id=batch_id, source_sha256=source_sha256)
        assertion = self.connection.state.service_assertion
        try:
            result, manifest = await self.prepare(
                projects.asset_access, title, document, files, owner, key, assertion
            )
            await self.archive.seal(owner, key, manifest, assertion)
            changed = await session.execute(
                update(PresentationImportBatch)
                .where(
                    PresentationImportBatch.batch_id == batch_id,
                    PresentationImportBatch.state == "staging",
                )
                .values(
                    state="commit",
                    manifest_sha256=manifest.fingerprint,
                    result=result.model_dump(mode="json"),
                    updated_at=utc_now(),
                )
            )
            if changed.rowcount != 1:
                raise PresentationError("归档源状态已变化", 409, "archive_pending")
        except BaseException as exc:
            await session.rollback()
            await self.delivery.release(owner, batch_id, retry=False)
            if isinstance(exc, CapabilityDenied):
                raise PresentationError("归档素材准备被拒绝", exc.status, "archive_denied") from exc
            if isinstance(exc, CapabilityUnavailable):
                raise PresentationError("归档素材准备未确认", 503, "archive_unavailable") from exc
            raise
        await session.commit()
        return await self.deliver(owner, batch_id)

    async def deliver(self, owner, batch_id):
        try:
            return await self.delivery.deliver(owner, batch_id)
        except (CapabilityDenied, CapabilityUnavailable) as exc:
            raise PresentationError("归档已保存，等待素材结算", 503, "archive_pending") from exc

    async def prepare(self, assets, title, document, files, owner, key, assertion):
        ids, staged, file_keys, vectors = {}, {}, [], {}
        for ordinal, (identity, file) in enumerate(sorted(files.items())):
            try:
                description = ModelOutputDescription(
                    file.filename,
                    file.mime_type,
                    len(file.content),
                    hashlib.sha256(file.content).hexdigest(),
                )
            except ValueError as exc:
                raise PresentationError("归档素材描述无效", 422, "invalid_archive_file") from exc
            asset = await self.archive.stage(
                owner, key, ordinal, description, file.content, assertion
            )
            ids[identity] = asset.id
            staged[asset.id] = asset
            file_keys.append(
                ArchiveFileKey(ordinal=ordinal, descriptor_sha256=description.fingerprint)
            )
            if asset.mime_type == "image/svg+xml":
                vectors[asset.id] = normalize_svg(file.content.decode())["monochrome"]

        project = payload(title, document, ids)
        references = document_references(project.document)
        rows = await assets.describe(references.keys() - staged.keys())

        async def monochrome(asset):
            return vectors[asset.id] if asset.id in vectors else await assets.monochrome(asset)

        await validate_assets(project.document, [*rows, *staged.values()], monochrome=monochrome)
        now = utc_now()
        result = PresentationProjectOut(
            **project.model_dump(), id=new_id(), revision=0, created_at=now, updated_at=now
        )
        manifest = PresentationManifest(
            project_id=result.id, files=file_keys, asset_ids=sorted(references)
        )
        return result, manifest

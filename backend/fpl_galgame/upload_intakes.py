"""Reserve Galgame names and recover exact committed Assets upload receipts."""

import mimetypes
from dataclasses import dataclass
from uuid import uuid4

import httpx
from sqlalchemy import select, text, update

from app.apps.galgame_workshop.assets.asset_analysis import plan_uploads
from app.apps.galgame_workshop.assets.asset_support import galgame_asset_out
from app.apps.galgame_workshop.models import GalgameAssetMetadata
from app.apps.galgame_workshop.schemas import GalgameAssetImportPreviewItem
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.framed_media import SIZE
from fpl_runtime.galgame_upload import PREFIX, PURPOSE, UploadManifest, UploadMember, UploadReceipt
from fpl_runtime.project_errors import ProjectResourceError

from .models import GalgameUploadIntake
from .projects import Projects

ASSETS = "http://assets:8080"


@dataclass(frozen=True)
class UploadSignature:
    filename: str
    mime_type: str | None
    byte_size: int
    sha256: str


class UploadIntakes(PollingTaskRunner):
    runner_name = "galgame-upload-intakes"
    poll_interval_seconds = 2

    def __init__(self, sessions, capabilities):
        super().__init__()
        self.sessions, self.capabilities = sessions, capabilities

    async def recover(self):
        # No HTTP upload starts before its exact POST assertion is committed.
        async with self.sessions(info={"allow_system_reads": True}) as db:
            stale = list(
                await db.execute(
                    select(GalgameUploadIntake.owner_user_id, GalgameUploadIntake.id).where(
                        GalgameUploadIntake.state == "reserved"
                    )
                )
            )
        for owner, identity in stale:
            await self.reject(owner, identity)

    async def require_project(self, owner, project_id):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await Projects(db, owner).row(project_id)

    async def reserve(
        self, owner, project_id, category, signatures, mode, *, assertion, source_path
    ):
        identity = uuid4().hex
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            await Projects(db, owner).row(project_id)
            existing_paths = list(
                await db.scalars(
                    select(GalgameAssetMetadata.virtual_path).where(
                        GalgameAssetMetadata.project_id == project_id
                    )
                )
            )
            for items in await db.scalars(
                select(GalgameUploadIntake.planned).where(
                    GalgameUploadIntake.owner_user_id == owner,
                    GalgameUploadIntake.project_id == project_id,
                    GalgameUploadIntake.state.in_(("reserved", "pending")),
                )
            ):
                existing_paths.extend(item["virtual_path"] for item in items)
            filenames = [item.filename for item in signatures]
            if mode == "annotation":
                plans = [
                    GalgameAssetImportPreviewItem(
                        original_name=name, final_name=name, virtual_path=f"voice/{name}"
                    )
                    for name in filenames
                ]
                existing = {path.casefold() for path in existing_paths}
                if any(item.virtual_path.casefold() in existing for item in plans):
                    raise ProjectResourceError(
                        "台词文件名称已占用", "annotation_clip_path_pending", 503
                    )
            else:
                plans = plan_uploads(filenames, category, existing_paths).items
            try:
                manifest = UploadManifest(
                    files=tuple(
                        UploadMember(
                            filename=item.final_name,
                            mime_type=signature.mime_type
                            or mimetypes.guess_type(item.final_name)[0]
                            or "application/octet-stream",
                            byte_size=signature.byte_size,
                            content_sha256=signature.sha256,
                        )
                        for item, signature in zip(plans, signatures, strict=True)
                    )
                )
            except ValueError as exc:
                raise ProjectResourceError("文件描述无效", "invalid_file_content", 422) from exc
            target = f"{PREFIX}/{project_id}/{identity}/{mode}/{manifest.digest}"
            row = GalgameUploadIntake(
                id=identity,
                owner_user_id=owner,
                project_id=project_id,
                target_path=target,
                category=category,
                manifest=manifest.model_dump(mode="json"),
                planned=[item.model_dump(mode="json") for item in plans],
            )
            db.add(row)
            await db.commit()
        grant = RequestGrant("galgame", PURPOSE, "POST", source_path, "assets", "POST", target)
        try:
            assertion = await self.capabilities.authorize_request(assertion, grant)
        except CapabilityDenied as exc:
            await self.reject(owner, identity)
            raise ProjectResourceError(
                "素材上传权限已撤销", "upload_access_denied", exc.status
            ) from exc
        except CapabilityUnavailable as exc:
            await self.reject(owner, identity)
            raise ProjectResourceError("素材上传授权暂不可用", "upload_unavailable", 503) from exc
        async with self.sessions(info={"owner_user_id": owner}) as db:
            result = await db.execute(
                update(GalgameUploadIntake)
                .where(GalgameUploadIntake.id == identity, GalgameUploadIntake.state == "reserved")
                .values(state="pending", assertion=assertion)
            )
            if result.rowcount != 1:
                raise ProjectResourceError("素材上传预留已失效", "upload_unavailable", 503)
            await db.commit()
        row.state, row.assertion = "pending", assertion
        return row, manifest

    async def reject(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(
                update(GalgameUploadIntake)
                .where(
                    GalgameUploadIntake.id == identity,
                    GalgameUploadIntake.state.in_(("reserved", "pending")),
                )
                .values(state="rejected", assertion="")
            )
            await db.commit()

    async def upload(self, pending, manifest, files):
        async def body():
            yield SIZE.pack(len(manifest.raw))
            yield manifest.raw
            for file in files:
                while chunk := await file.read(1024 * 1024):
                    yield chunk

        try:
            response = await self.capabilities.client.post(
                ASSETS + pending.target_path,
                headers={
                    HEADER: pending.assertion,
                    "Content-Type": "application/octet-stream",
                    "Content-Length": str(manifest.total_bytes),
                },
                content=body(),
                timeout=httpx.Timeout(600, connect=5),
            )
            if response.status_code in {401, 403, 404, 409, 410, 413, 415, 422}:
                await self.reject(pending.owner_user_id, pending.id)
                error = response.json()
                raise ProjectResourceError(
                    str(error.get("detail", "素材上传被拒绝")),
                    str(error.get("code", "upload_rejected")),
                    response.status_code,
                )
            response.raise_for_status()
            return await self.settle(pending, UploadReceipt.model_validate_json(response.content))
        except (httpx.HTTPError, CapabilityUnavailable, ValueError, KeyError) as exc:
            raise ProjectResourceError("素材上传回执未确认", "upload_unconfirmed", 503) from exc

    async def settle(self, pending, receipt):
        manifest = UploadManifest.model_validate(pending.manifest)
        plans = [GalgameAssetImportPreviewItem.model_validate(item) for item in pending.planned]
        if len(receipt.items) != len(manifest.files) or len(
            {row.id for row in receipt.items}
        ) != len(plans):
            raise ValueError("upload receipt count mismatch")
        for row, expected in zip(receipt.items, manifest.files, strict=True):
            if (
                row.inspection is None
                or row.inspection.sha256 != expected.content_sha256
                or row.byte_size != expected.byte_size
                or row.original_filename != expected.filename
            ):
                raise ValueError("upload receipt member mismatch")
        owner, project = pending.owner_user_id, pending.project_id
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            current = await db.get(GalgameUploadIntake, pending.id)
            if current is None or current.state not in {"pending", "settled"}:
                raise ValueError("upload intake unavailable")
            await Projects(db, owner).row(project)
            entries = []
            for row, plan in zip(receipt.items, plans, strict=True):
                metadata = await db.get(GalgameAssetMetadata, row.id)
                if metadata is not None and metadata.project_id != project:
                    raise ValueError("upload receipt project mismatch")
                if current.state == "pending":
                    if metadata is None:
                        metadata = GalgameAssetMetadata(
                            asset_id=row.id,
                            project_id=project,
                            transcript_status="pending" if row.media_kind == "audio" else "ready",
                        )
                        db.add(metadata)
                    probe = row.inspection
                    metadata.category = pending.category
                    metadata.virtual_path = plan.virtual_path
                    metadata.checksum_sha256 = probe.sha256
                    metadata.width = probe.width
                    metadata.height = probe.height
                    metadata.duration_ms = probe.duration_ms
                if metadata is None:
                    raise ValueError("upload metadata missing after settlement")
                entries.append((row, metadata))
            current.state, current.assertion = "settled", ""
            await db.flush()
            items = [galgame_asset_out(row, meta) for row, meta in entries]
            await db.commit()
        return items, plans

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as db:
            pending = await db.scalar(
                select(GalgameUploadIntake)
                .where(GalgameUploadIntake.state == "pending")
                .order_by(GalgameUploadIntake.checked_at, GalgameUploadIntake.id)
                .limit(1)
            )
        if pending is None:
            return
        try:
            response = await self.capabilities.client.get(
                ASSETS + pending.target_path, headers={HEADER: pending.assertion}
            )
            if response.status_code == 410:
                await self.reject(pending.owner_user_id, pending.id)
            elif response.status_code != 404:
                response.raise_for_status()
                await self.settle(pending, UploadReceipt.model_validate_json(response.content))
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            raise CapabilityUnavailable("素材上传回执未确认") from exc
        finally:
            async with self.sessions(info={"owner_user_id": pending.owner_user_id}) as db:
                await db.execute(
                    update(GalgameUploadIntake)
                    .where(
                        GalgameUploadIntake.id == pending.id, GalgameUploadIntake.state == "pending"
                    )
                    .values(checked_at=utc_now())
                )
                await db.commit()

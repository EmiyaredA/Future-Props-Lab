"""Build the existing portable Galgame archive from owner-verified originals."""

import shutil
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
from sqlalchemy import select

from app.capabilities.asset_store.project_snapshots import (
    ProjectSnapshotError,
    SnapshotAssetSource,
    export_project_snapshot,
)
from studio.apps.galgame_workshop.project_values import project_out
from studio.apps.galgame_workshop.snapshot_values import snapshot_asset_record
from studio.apps.galgame_workshop.storage.models import (
    GalgameAssetSettings,
    GalgameStoryDocument,
    GalgameVideoExportTask,
)
from studio.contracts.asset_library.descriptions import ID
from studio.contracts.galgame_workshop.galgame_assets import PREFIX
from studio.contracts.galgame_workshop.galgame_snapshot import (
    FILES_PURPOSE,
    MODEL_PURPOSE,
    MODEL_REFERENCE_PREFIX,
    ModelReference,
)
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.motion_compositor.motion_preview import FrameFile
from studio.contracts.motion_compositor.motion_snapshot import SnapshotScope
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.http.framed_media import SIZE, FramedInputs


@dataclass(frozen=True)
class SnapshotSettings:
    runtime_path: Path
    fpl_project_snapshot_max_bytes: int = 8 * 1024**3
    fpl_project_snapshot_max_files: int = 10_000


class SnapshotExports:
    def __init__(self, request, files):
        self.request, self.files = request, files
        self.settings = request.app.state.snapshot_settings

    async def export(self, project_id):
        files = self.files
        db = files.session
        project = await files.projects.row(project_id)
        story = await files.projects.story(project_id)
        row = await db.get(GalgameStoryDocument, project_id)
        document = row.document
        used = {asset.file_id for asset in story.document.assets}
        provenance = project_out(project).model_dump(mode="json")
        title = project.title
        project_values = {"title": title, "status": project.status}
        output_ids = set(
            await db.scalars(
                select(GalgameVideoExportTask.output_asset_id).where(
                    GalgameVideoExportTask.project_id == project_id,
                    GalgameVideoExportTask.output_asset_id.is_not(None),
                )
            )
        )
        settings = await db.get(GalgameAssetSettings, project_id)
        model_id = settings.asr_model_id if settings else None
        asset_settings = {
            "default_language": settings.default_language if settings else "auto",
            "concurrency": settings.concurrency if settings else 2,
        }
        records = [
            (asset, metadata)
            for asset, metadata in await files.asset_records(project_id, used, newest_first=False)
            if asset.id not in output_ids or asset.id in used
        ]
        if used - {asset.id for asset, _ in records} or any(
            not asset.exists for asset, _ in records
        ):
            raise ProjectSnapshotError(
                "项目素材文件不存在，无法生成完整快照", code="snapshot_source_missing", status=409
            )
        assets = sorted((asset for asset, _ in records), key=lambda asset: asset.id)
        metadata = [
            snapshot_asset_record(asset, meta, index)
            for index, (asset, meta) in enumerate(records, 1)
        ]
        await db.rollback()
        asset_settings["model_reference"] = await self.model_reference(model_id)
        root = self.staging(assets)
        with TemporaryDirectory(dir=root, prefix="galgame-export-") as folder:
            originals = await self.originals(project_id, assets, Path(folder)) if assets else []
            exported = await export_project_snapshot(
                self.settings,
                application_id="galgame-workshop",
                title=title,
                source_project=provenance,
                project={
                    "schema_version": 1,
                    "project": project_values,
                    "story": document,
                    "assets": metadata,
                    "asset_settings": asset_settings,
                },
                assets=originals,
            )
        try:
            status = await self.request.app.state.live_authorization.status(
                assertion=files.assertion, method="GET", path=files.source_path
            )
            if status is not True:
                raise ProjectSnapshotError(
                    "项目快照授权已结束", status=401 if status is False else 503
                )
            return exported
        except BaseException:
            exported.path.unlink(missing_ok=True)
            raise

    def staging(self, assets):
        root = self.settings.runtime_path / ".tmp" / "project-snapshots"
        if root.is_symlink() or not root.resolve().is_relative_to(self.settings.runtime_path):
            raise ProjectSnapshotError("项目快照暂存目录不可用", status=503)
        if len(assets) + 2 > self.settings.fpl_project_snapshot_max_files:
            raise ProjectSnapshotError(
                "项目快照文件数量超过限制", code="snapshot_too_many_files", status=413
            )
        size = sum(asset.byte_size for asset in assets)
        if size > self.settings.fpl_project_snapshot_max_bytes:
            raise ProjectSnapshotError(
                "项目快照超过大小限制", code="snapshot_too_large", status=413
            )
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if shutil.disk_usage(root).free < 2 * size:
            raise ProjectSnapshotError(
                "磁盘空间不足，无法生成项目快照", code="snapshot_disk_full", status=507
            )
        return root

    async def model_reference(self, model_id):
        import re

        if model_id is None or not re.fullmatch(ID, model_id):
            return None
        files = self.files
        target = f"{MODEL_REFERENCE_PREFIX}/{model_id}"
        grant = RequestGrant(
            "galgame", MODEL_PURPOSE, "GET", files.source_path, "models", "GET", target
        )
        try:
            token = await files.capabilities.authorize_request(files.assertion, grant)
            response = await files.capabilities.client.get(
                "http://models:8080" + target, headers={HEADER: token}
            )
            if response.status_code in {401, 403}:
                raise CapabilityDenied(response.status_code)
            response.raise_for_status()
            value = response.json()
            return ModelReference.model_validate(value).model_dump() if value is not None else None
        except CapabilityDenied as exc:
            raise ProjectSnapshotError("项目快照模型授权已结束", status=exc.status) from exc
        except (CapabilityUnavailable, httpx.HTTPError, ValueError) as exc:
            raise ProjectSnapshotError("项目快照模型目录暂不可读", status=503) from exc

    async def originals(self, project, assets, directory):
        files = self.files
        scope = SnapshotScope(
            files=tuple(FrameFile(id=row.id, revision=row.revision) for row in assets)
        )
        target = f"{PREFIX}/{project}/snapshot/{scope.digest}"
        grant = RequestGrant(
            "galgame", FILES_PURPOSE, "GET", files.source_path, "assets", "POST", target
        )
        try:
            token = await files.capabilities.authorize_request(files.assertion, grant)
            async with files.capabilities.client.stream(
                "POST",
                "http://assets:8080" + target,
                content=scope.model_dump_json().encode(),
                headers={HEADER: token, "Accept-Encoding": "identity"},
                timeout=httpx.Timeout(300, connect=5),
            ) as response:
                if response.status_code in {404, 409}:
                    raise ProjectSnapshotError(
                        "项目素材在导出过程中发生变化，请重试",
                        code="snapshot_source_changed",
                        status=409,
                    )
                if response.status_code in {401, 403}:
                    raise CapabilityDenied(response.status_code)
                response.raise_for_status()
                if (
                    response.headers.get("Content-Encoding", "identity") != "identity"
                    or response.headers.get("Content-Type") != "application/octet-stream"
                ):
                    raise ValueError("unexpected snapshot response")
                expected = sum(SIZE.size + asset.byte_size for asset in assets)
                if int(response.headers["Content-Length"]) != expected:
                    raise ValueError("snapshot source total size mismatch")
                framed = FramedInputs(response.aiter_bytes(chunk_size=1024 * 1024))
                output = []
                for index, asset in enumerate(assets):
                    size = SIZE.unpack(await framed.read(SIZE.size))[0]
                    if size != asset.byte_size:
                        raise ValueError("snapshot original size mismatch")
                    path = directory / str(index)
                    with path.open("xb") as file:
                        await framed.transfer(file, size)
                    output.append(SnapshotAssetSource(asset.id, path))
                await framed.require_end(expected)
                return output
        except CapabilityDenied as exc:
            raise ProjectSnapshotError("项目快照素材授权已结束", status=exc.status) from exc
        except (CapabilityUnavailable, httpx.HTTPError, OSError, KeyError, ValueError) as exc:
            raise ProjectSnapshotError("项目快照原件暂不可用", status=503) from exc

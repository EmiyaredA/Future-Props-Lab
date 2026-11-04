"""Export the original Video snapshot format from exact Assets revisions."""

import shutil
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
from fastapi import HTTPException

from app.apps.video_editor.projects import VideoEditorProjects, project_out
from app.apps.video_editor.snapshot_queries import output_asset_ids, timeline_asset_ids
from app.apps.video_editor.timeline_read import VideoTimelineRead
from app.capabilities.asset_store.project_snapshots import (
    ProjectSnapshotError,
    SnapshotAssetSource,
    export_project_snapshot,
)
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.framed_media import SIZE, FramedInputs
from fpl_runtime.motion_preview import FrameFile
from fpl_runtime.motion_snapshot import SnapshotScope
from fpl_runtime.video_assets import PREFIX, VideoAsset
from fpl_runtime.video_snapshot import PURPOSE

from .media_reads import MediaReads


@dataclass(frozen=True)
class SnapshotSettings:
    runtime_path: Path
    fpl_project_snapshot_max_bytes: int = 8 * 1024**3
    fpl_project_snapshot_max_files: int = 10_000


def snapshot_asset(asset):
    return {
        "id": asset.id,
        "original_filename": asset.original_filename,
        "display_name": asset.display_name,
        "media_kind": asset.media_kind,
        "mime_type": asset.mime_type,
        "byte_size": asset.byte_size,
    }


class SnapshotExports:
    def __init__(self, request, session, owner):
        self.request, self.session, self.owner = request, session, owner
        self.state = request.app.state

    async def snapshot(self, project_id):
        session = self.session
        project = await VideoEditorProjects(session, self.owner).row(project_id)
        timeline = await VideoTimelineRead(session, self.owner).row(project_id)
        excluded = await output_asset_ids(session, self.owner, project_id)
        document = timeline.document
        required = timeline_asset_ids(document)
        title = project.title
        provenance = project_out(project).model_dump(mode="json", by_alias=True)
        project_record = {
            "title": title,
            "status": project.status,
            "source_application": project.source_application,
            "source_project_id": project.source_project_id,
            "source_revision": project.source_revision,
            "source_compiler_version": project.source_compiler_version,
        }
        await session.rollback()
        result = await MediaReads(self.request, session, self.owner).read(
            f"{PREFIX}/{project_id}/files"
        )
        originals = sorted(
            (
                VideoAsset.model_validate(item)
                for item in result["items"]
                if item["id"] not in excluded or item["id"] in required
            ),
            key=lambda item: item.id,
        )
        if required - {asset.id for asset in originals}:
            raise ProjectSnapshotError(
                "项目素材文件不存在，无法生成完整快照", code="snapshot_source_missing", status=409
            )
        settings = self.state.video_snapshot_settings
        root = settings.runtime_path / ".tmp" / "project-snapshots"
        if root.is_symlink() or not root.resolve().is_relative_to(settings.runtime_path):
            raise ProjectSnapshotError("项目快照暂存目录不可用", status=503)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if len(originals) + 2 > settings.fpl_project_snapshot_max_files:
            raise ProjectSnapshotError(
                "项目快照文件数量超过限制", code="snapshot_too_many_files", status=413
            )
        total = sum(asset.byte_size for asset in originals)
        if total > settings.fpl_project_snapshot_max_bytes:
            raise ProjectSnapshotError(
                "项目快照超过大小限制", code="snapshot_too_large", status=413
            )
        if shutil.disk_usage(root).free < total * 2:
            raise ProjectSnapshotError(
                "磁盘空间不足，无法生成项目快照", code="snapshot_disk_full", status=507
            )
        with TemporaryDirectory(dir=root, prefix="video-export-") as directory:
            paths = (
                await self.originals(project_id, originals, Path(directory)) if originals else []
            )
            exported = await export_project_snapshot(
                settings,
                application_id="video-editor",
                title=title,
                source_project=provenance,
                project={
                    "schema_version": 1,
                    "project": project_record,
                    "timeline": document,
                    "assets": [snapshot_asset(asset) for asset in originals],
                },
                assets=paths,
            )
        try:
            active = await self.state.handoff_identity.status(
                assertion=self.request.state.service_assertion,
                method="GET",
                path=self.request.url.path,
            )
            if active is None:
                raise HTTPException(503, "identity_unavailable")
            if not active:
                raise HTTPException(401, "video_snapshot_revoked")
            return exported
        except BaseException:
            exported.path.unlink(missing_ok=True)
            raise

    async def originals(self, project, assets, directory):
        scope = SnapshotScope(
            files=tuple(FrameFile(id=item.id, revision=item.revision) for item in assets)
        )
        target = f"{PREFIX}/{project}/snapshot/{scope.digest}"
        grant = RequestGrant(
            "video", PURPOSE, "GET", self.request.url.path, "assets", "POST", target
        )
        capabilities = self.state.capabilities
        try:
            token = await capabilities.authorize_request(
                self.request.state.service_assertion, grant
            )
            async with capabilities.client.stream(
                "POST",
                "http://assets:8080" + target,
                content=scope.model_dump_json().encode(),
                headers={HEADER: token, "Accept-Encoding": "identity"},
                timeout=httpx.Timeout(300, connect=5),
            ) as response:
                if response.status_code == 409:
                    raise ProjectSnapshotError(
                        "项目素材在导出过程中发生变化，请重试",
                        code="snapshot_source_changed",
                        status=409,
                    )
                response.raise_for_status()
                if (
                    response.headers.get("Content-Encoding", "identity") != "identity"
                    or response.headers.get("Content-Type") != "application/octet-stream"
                ):
                    raise ValueError("unexpected video snapshot response")
                total = int(response.headers["Content-Length"])
                framed = FramedInputs(response)
                output = []
                for index, asset in enumerate(assets):
                    size = SIZE.unpack(await framed.read(SIZE.size))[0]
                    if size != asset.byte_size:
                        raise ValueError("video snapshot source size mismatch")
                    path = directory / f"{index:06d}"
                    with path.open("xb") as file:
                        await framed.transfer(file, size)
                    output.append(SnapshotAssetSource(asset.id, path))
                await framed.require_end(total)
                return output
        except (
            CapabilityDenied,
            CapabilityUnavailable,
            httpx.HTTPError,
            OSError,
            KeyError,
            ValueError,
        ):
            raise ProjectSnapshotError("项目快照原件暂不可用", status=503) from None

"""Seal the compiled Galgame timeline in the existing Video project package format."""

from dataclasses import dataclass
from pathlib import Path

from anyio.to_thread import run_sync

from app.capabilities.media_rendering.galgame.compiler import FLOATING_TEXT_FONT_ASSET_ID
from app.capabilities.media_rendering.galgame.timing import COMPILER_VERSION
from studio.contracts.galgame_workshop.galgame_handoff import HandoffMedia
from studio.runtime.files.project_archives import SnapshotAssetSource, export_project_snapshot
from studio.runtime.files.signed_payloads import ModelOutputDescription


@dataclass(frozen=True)
class PackageSettings:
    runtime_path: Path
    fpl_project_snapshot_max_bytes: int = 8 * 1024**3
    fpl_project_snapshot_max_files: int = 10_000


def asset_description(body, identity):
    if source := body.sources.get(identity):
        return source.model_dump()
    if identity.startswith("generated-dialogue-"):
        filename = f"dialogue-ui-{identity.removeprefix('generated-dialogue-')}.png"
        mime, kind = "image/png", "image"
    elif identity == FLOATING_TEXT_FONT_ASSET_ID:
        filename = "NotoSansSC-Regular.ttf"
        mime, kind = "font/ttf", "font"
    else:
        raise ValueError("剪辑交接生成了未登记的素材")
    return {
        "original_filename": filename,
        "display_name": filename,
        "mime_type": mime,
        "media_kind": kind,
    }


async def make_handoff_archive(root, project_id, body, compiled):
    project = {
        "title": body.title,
        "status": "draft",
        "source_application": "galgame-workshop",
        "source_project_id": project_id,
        "source_revision": body.source_revision,
        "source_compiler_version": COMPILER_VERSION,
    }
    assets = []
    sources = []
    for identity, file in sorted(compiled.asset_paths.items()):
        assets.append(
            {"id": identity, "byte_size": file.stat().st_size, **asset_description(body, identity)}
        )
        sources.append(SnapshotAssetSource(identity, file))
    timeline = compiled.document.model_dump(mode="json", by_alias=True, exclude_none=True)
    package = await export_project_snapshot(
        PackageSettings(root),
        application_id="video-editor",
        title=body.title,
        source_project=project,
        project={"schema_version": 1, "project": project, "timeline": timeline, "assets": assets},
        assets=sources,
    )
    try:
        file = await run_sync(
            ModelOutputDescription.from_file, package.path, "video-handoff.zip", "application/zip"
        )
        return package.path, HandoffMedia(
            byte_size=file.byte_size,
            content_sha256=file.content_sha256,
            track_count=len(timeline["tracks"]),
            asset_count=len(assets),
        )
    except BaseException:
        package.path.unlink(missing_ok=True)
        raise

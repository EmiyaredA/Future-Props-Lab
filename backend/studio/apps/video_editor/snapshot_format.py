"""Validate the shared portable Video snapshot and remap its local file IDs."""

from copy import deepcopy
from pathlib import Path

from pydantic import ValidationError

from studio.apps.video_editor.schemas import VideoEditorProjectCreateIn, parse_timeline_document
from studio.apps.video_editor.snapshot_queries import timeline_asset_ids
from studio.runtime.files.project_archives import ProjectSnapshotError


def _copy_title(title: str) -> str:
    suffix = "（副本）"
    return f"{title[: 120 - len(suffix)]}{suffix}"


def _validated_assets(value: object, declared: set[str]) -> list[dict]:
    if not isinstance(value, list):
        raise ProjectSnapshotError("视频剪辑快照素材必须是数组")
    records: list[dict] = []
    ids: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            raise ProjectSnapshotError("视频剪辑快照包含无效素材记录")
        asset_id = str(item.get("id") or "")
        filename = Path(str(item.get("original_filename") or "")).name
        display_name = str(item.get("display_name") or "").strip()
        byte_size = item.get("byte_size")
        if (
            not asset_id
            or asset_id in ids
            or asset_id not in declared
            or not filename
            or not display_name
            or not isinstance(byte_size, int)
            or byte_size < 1
            or item.get("media_kind") not in {"image", "video", "audio", "font", "document"}
            or not str(item.get("mime_type") or "")
        ):
            raise ProjectSnapshotError("视频剪辑快照素材元数据无效")
        ids.add(asset_id)
        records.append(dict(item, original_filename=filename, display_name=display_name))
    if ids != declared:
        raise ProjectSnapshotError("视频剪辑素材记录与快照清单不一致")
    return records


def _optional_string(value: object, *, max_length: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > max_length:
        raise ProjectSnapshotError("视频剪辑项目来源信息无效")
    return value


def _optional_revision(value: object) -> int | None:
    if value is None:
        return None
    if not isinstance(value, int) or value < 0:
        raise ProjectSnapshotError("视频剪辑项目来源信息无效")
    return value


def validated_snapshot(staged, *, handoff_project=None):
    payload = staged.project
    source = payload.get("project")
    if payload.get("schema_version") != 1 or not isinstance(source, dict):
        raise ProjectSnapshotError("project.json 不是受支持的视频剪辑快照")
    try:
        create = VideoEditorProjectCreateIn.model_validate(source)
        document = parse_timeline_document(payload.get("timeline")).model_dump(
            mode="json", by_alias=True
        )
    except ValidationError as exc:
        raise ProjectSnapshotError("视频剪辑时间线结构无效") from exc
    status = str(source.get("status") or "")
    if status not in {"draft", "completed"}:
        raise ProjectSnapshotError("视频剪辑项目状态无效")
    if handoff_project is not None and (
        source.get("source_application") != "galgame-workshop"
        or source.get("source_project_id") != handoff_project
        or source.get("source_revision") is None
        or not source.get("source_compiler_version")
        or status != "draft"
    ):
        raise ProjectSnapshotError("Galgame 剪辑交接来源信息无效")
    declared = {item.source_id for item in staged.manifest.assets}
    assets = _validated_assets(payload.get("assets"), declared)
    if timeline_asset_ids(document) - declared:
        raise ProjectSnapshotError("时间线或素材编排引用的素材未包含在项目快照中")
    return (
        {
            "title": create.title if handoff_project is not None else _copy_title(create.title),
            "status": status,
            "source_application": _optional_string(source.get("source_application"), max_length=32),
            "source_project_id": _optional_string(source.get("source_project_id"), max_length=36),
            "source_revision": _optional_revision(source.get("source_revision")),
            "source_compiler_version": _optional_string(
                source.get("source_compiler_version"), max_length=64
            ),
        },
        document,
        assets,
    )


def remap_timeline(document, identities):
    remapped = deepcopy(document)
    for track in remapped.get("tracks", []):
        for clip in track.get("clips", []):
            for key in ("assetId", "fontAssetId"):
                if clip.get(key):
                    clip[key] = identities[clip[key]]
    organization = remapped.get("assetOrganization") or {}
    if organization.get("rootAssetIds"):
        organization["rootAssetIds"] = [identities[value] for value in organization["rootAssetIds"]]
    for folder in organization.get("folders") or []:
        if folder.get("assetIds"):
            folder["assetIds"] = [identities[value] for value in folder["assetIds"]]
    return remapped

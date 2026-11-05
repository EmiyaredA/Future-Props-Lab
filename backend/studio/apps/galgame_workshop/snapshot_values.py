"""Portable Galgame project asset record shared by both website assemblies."""

from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from pydantic import BaseModel, Field, ValidationError

from studio.apps.galgame_workshop.assets.asset_support import ProjectAssetFile
from studio.apps.galgame_workshop.schemas import GalgameStoryProject, GalgameWorkshopProjectCreateIn
from studio.apps.galgame_workshop.schemas.asr import GalgameTranscriptSegmentOut
from studio.apps.galgame_workshop.storage.models import GalgameAssetMetadata
from studio.contracts.asset_library.project_snapshots import ProjectSnapshotImportWarning
from studio.runtime.files.project_archives import ProjectSnapshotError


def _fallback_category(asset: ProjectAssetFile) -> str:
    return {
        "video": "video",
        "audio": "voice",
        "font": "font",
    }.get(asset.media_kind, "other")


def snapshot_asset_record(
    asset: ProjectAssetFile, metadata: GalgameAssetMetadata | None, fallback_index: int
) -> dict:
    virtual_path = (
        metadata.virtual_path
        if metadata is not None and metadata.virtual_path
        else f"assets/imported-{fallback_index:04d}-{asset.original_filename}"
    )
    return {
        "id": asset.id,
        "original_filename": asset.original_filename,
        "display_name": asset.display_name,
        "media_kind": asset.media_kind,
        "mime_type": asset.mime_type,
        "byte_size": asset.byte_size,
        "category": metadata.category if metadata else _fallback_category(asset),
        "virtual_path": virtual_path,
        "packaging_policy": metadata.packaging_policy if metadata else "auto",
        "checksum_sha256": metadata.checksum_sha256 if metadata else None,
        "width": metadata.width if metadata else None,
        "height": metadata.height if metadata else None,
        "duration_ms": metadata.duration_ms if metadata else None,
        "transcript": metadata.transcript if metadata else None,
        "transcript_language": metadata.transcript_language if metadata else None,
        "transcript_status": metadata.transcript_status if metadata else "pending",
        "transcript_source": metadata.transcript_source if metadata else None,
        "transcript_revision": metadata.transcript_revision if metadata else 0,
        "transcript_segments": deepcopy(metadata.transcript_segments or []) if metadata else [],
    }


VALID_CATEGORIES = {
    "character",
    "scene",
    "cg",
    "bgm",
    "ambient",
    "sfx",
    "voice",
    "video",
    "font",
    "other",
}
VALID_TRANSCRIPT_STATUS = {"pending", "queued", "running", "ready", "failed"}


def copy_title(title: str) -> str:
    suffix = "（副本）"
    return f"{title[: 120 - len(suffix)]}{suffix}"


def story_file_ids(document: dict) -> set[str]:
    return {
        str(item["fileId"])
        for item in document.get("assets", [])
        if isinstance(item, dict) and item.get("fileId")
    }


class SnapshotMediaMetadata(BaseModel):
    checksum_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    width: int | None = Field(default=None, strict=True, ge=0, lt=2**63)
    height: int | None = Field(default=None, strict=True, ge=0, lt=2**63)
    duration_ms: int | None = Field(default=None, strict=True, ge=0, lt=2**63)
    transcript: str | None = None
    transcript_language: str | None = Field(default=None, max_length=16)


def _validated_assets(value: object, declared: set[str]) -> list[dict]:
    if not isinstance(value, list):
        raise ProjectSnapshotError("Galgame 快照素材必须是数组")
    records: list[dict] = []
    ids: set[str] = set()
    virtual_paths: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            raise ProjectSnapshotError("Galgame 快照包含无效素材记录")
        asset_id = str(item.get("id") or "")
        filename = Path(str(item.get("original_filename") or "")).name
        display_name = str(item.get("display_name") or "").strip()
        virtual_path = str(item.get("virtual_path") or "")
        path = PurePosixPath(virtual_path)
        byte_size = item.get("byte_size")
        transcript_revision = item.get("transcript_revision", 0)
        transcript_segments = item.get("transcript_segments", [])
        try:
            validated_metadata = SnapshotMediaMetadata.model_validate(item)
            validated_segments = [
                GalgameTranscriptSegmentOut.model_validate(segment).model_dump(
                    mode="json", by_alias=True
                )
                for segment in transcript_segments
            ]
        except (TypeError, ValidationError) as exc:
            raise ProjectSnapshotError("Galgame 快照媒体元数据或转写分段无效") from exc
        if (
            not asset_id
            or asset_id in ids
            or asset_id not in declared
            or not filename
            or not display_name
            or type(byte_size) is not int
            or byte_size < 1
            or item.get("media_kind") not in ("image", "video", "audio", "font", "document")
            or not str(item.get("mime_type") or "")
            or not isinstance(item.get("category"), str)
            or item["category"] not in VALID_CATEGORIES
            or item.get("packaging_policy") not in ("auto", "include", "exclude")
            or not isinstance(item.get("transcript_status"), str)
            or item["transcript_status"] not in VALID_TRANSCRIPT_STATUS
            or item.get("transcript_source") not in (None, "asr", "manual")
            or type(transcript_revision) is not int
            or not 0 <= transcript_revision < 2**63
            or not isinstance(transcript_segments, list)
            or path.is_absolute()
            or ".." in path.parts
            or len(path.parts) < 2
            or virtual_path.casefold() in virtual_paths
        ):
            raise ProjectSnapshotError("Galgame 快照素材元数据无效")
        ids.add(asset_id)
        virtual_paths.add(virtual_path.casefold())
        records.append(
            dict(
                {**item, **validated_metadata.model_dump()},
                original_filename=filename,
                display_name=display_name,
                transcript_revision=transcript_revision,
                transcript_segments=validated_segments,
            )
        )
    if ids != declared:
        raise ProjectSnapshotError("Galgame 素材记录与快照清单不一致")
    return records


@dataclass(frozen=True)
class SnapshotValues:
    title: str
    status: str
    document: dict
    assets: list[dict]
    language: str
    concurrency: int
    model_reference: object

    def with_files(self, identities):
        document = deepcopy(self.document)
        for item in document["assets"]:
            item["fileId"] = identities[item["fileId"]]
        return document

    def model_warnings(self, model_id):
        if self.model_reference and not model_id:
            return [
                ProjectSnapshotImportWarning(
                    code="model_binding_unavailable",
                    field="asset_settings.model_id",
                    message="原语音识别模型在当前账号中不可用，请重新选择。",
                )
            ]
        return []


def validate_snapshot(staged):
    payload = staged.project
    source = payload.get("project")
    if payload.get("schema_version") != 1 or not isinstance(source, dict):
        raise ProjectSnapshotError("project.json 不是受支持的 Galgame 快照")
    try:
        project = GalgameWorkshopProjectCreateIn.model_validate(source)
        story = GalgameStoryProject.model_validate(payload.get("story"))
    except ValidationError as exc:
        raise ProjectSnapshotError("Galgame Story 结构无效") from exc
    status = str(source.get("status") or "")
    if status not in {"draft", "completed"}:
        raise ProjectSnapshotError("Galgame 项目状态无效")
    declared = {item.source_id for item in staged.manifest.assets}
    assets = _validated_assets(payload.get("assets"), declared)
    document = story.model_dump(mode="json", by_alias=True)
    if not story_file_ids(document) <= declared:
        raise ProjectSnapshotError("Story 引用的素材未包含在项目快照中")
    settings = payload.get("asset_settings")
    settings = settings if isinstance(settings, dict) else {}
    language = str(settings.get("default_language") or "auto")
    concurrency = settings.get("concurrency", 2)
    if (
        language not in {"auto", "zh", "ja"}
        or not isinstance(concurrency, int)
        or not 1 <= concurrency <= 8
    ):
        raise ProjectSnapshotError("Galgame ASR 设置无效")
    return SnapshotValues(
        copy_title(project.title),
        status,
        document,
        assets,
        language,
        concurrency,
        settings.get("model_reference"),
    )

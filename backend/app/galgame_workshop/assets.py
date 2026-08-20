from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path, PurePosixPath

from fastapi import UploadFile
from PIL import Image
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from tinytag import TinyTag
except ImportError:  # pragma: no cover - dependency is required in production
    TinyTag = None  # type: ignore[assignment]

from app.concurrency.revisions import RevisionConflictError
from app.core.config import Settings
from app.core.time import iso_utc
from app.files import AssetError, AssetLibrary
from app.files.policy import GALGAME_EXTENSIONS
from app.files.storage import AssetStorage
from app.galgame_workshop.errors import GalgameWorkshopProjectNotFoundError
from app.galgame_workshop.story import normalize_story_document
from app.models import (
    GalgameAssetMetadata,
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameWorkshopProject,
    VisualAsset,
)
from app.schemas.galgame_workshop import (
    GalgameAssetBatchUploadOut,
    GalgameAssetImportPreviewItem,
    GalgameAssetImportPreviewOut,
    GalgameAssetOverviewItem,
    GalgameAssetOverviewOut,
    GalgameAssetPackagingPolicy,
    GalgameAssetReferenceLocation,
    GalgameMissingAssetOverviewItem,
    GalgamePackageManifestIssue,
    GalgamePackageManifestItem,
    GalgamePackageManifestOut,
    GalgameProjectAssetListOut,
    GalgameProjectAssetOut,
    GalgameProjectAssetPatchIn,
    GalgameStoryAudioBlock,
    GalgameStoryDialogueBlock,
    GalgameStoryShowCgBlock,
    GalgameStoryVideoBlock,
)

CATEGORY_DIRECTORIES = {
    "character": "characters",
    "scene": "backgrounds",
    "cg": "cg",
    "bgm": "bgm",
    "ambient": "se",
    "sfx": "se",
    "voice": "voice",
    "video": "video",
    "font": "fonts",
    "other": "assets",
}
RESERVED_FILENAME_RE = re.compile(r"[\x00-\x1f\x7f%#?&<>:\"|*]+")


def _default_category(row: VisualAsset) -> str:
    return "video" if row.media_kind == "video" else "font" if row.media_kind == "font" else "other"


def _default_virtual_path(row: VisualAsset, category: str | None = None) -> str:
    directory = CATEGORY_DIRECTORIES[category or _default_category(row)]
    filename = f"{row.display_name}{Path(row.original_filename).suffix.lower()}"
    return f"{directory}/{filename}"


def galgame_asset_out(
    row: VisualAsset, metadata: GalgameAssetMetadata | None = None
) -> GalgameProjectAssetOut:
    category = metadata.category if metadata else _default_category(row)
    return GalgameProjectAssetOut(
        id=row.id,
        display_name=row.display_name,
        media_kind=row.media_kind,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
        category=category,
        virtualPath=metadata.virtual_path if metadata else _default_virtual_path(row, category),
        packagingPolicy=metadata.packaging_policy if metadata else "auto",
        checksumSha256=metadata.checksum_sha256 if metadata else None,
        width=metadata.width if metadata else None,
        height=metadata.height if metadata else None,
        durationMs=metadata.duration_ms if metadata else None,
        transcript=metadata.transcript if metadata else None,
        transcriptLanguage=metadata.transcript_language if metadata else None,
        transcriptStatus=metadata.transcript_status if metadata else "pending",
        transcriptSource=metadata.transcript_source if metadata else None,
        transcriptRevision=metadata.transcript_revision if metadata else 0,
        transcriptSegments=list(metadata.transcript_segments or []) if metadata else [],
    )


def normalize_import_filename(value: str) -> tuple[str, list[str]]:
    reasons: list[str] = []
    path_normalized = value.replace("\\", "/")
    basename = PurePosixPath(path_normalized).name
    if basename != value:
        reasons.append("已移除原始路径")
    normalized = unicodedata.normalize("NFC", basename)
    cleaned = RESERVED_FILENAME_RE.sub("-", normalized)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(". ")
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    if cleaned != normalized:
        reasons.append("已替换控制字符或保留符号")
    if not cleaned or cleaned in {".", ".."}:
        suffix = Path(normalized).suffix.lower()
        cleaned = f"asset{suffix}"
        reasons.append("空文件名已使用安全名称")
    return cleaned[:255], reasons


def _deduplicated_name(name: str, used: set[str]) -> tuple[str, bool]:
    suffix = Path(name).suffix
    stem = name[: -len(suffix)] if suffix else name
    candidate = name
    index = 2
    while candidate.casefold() in used:
        candidate = f"{stem}-{index}{suffix}"
        index += 1
    used.add(candidate.casefold())
    return candidate, candidate != name


def _file_metadata(path: Path, media_kind: str) -> tuple[str, int | None, int | None, int | None]:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    if media_kind == "image":
        try:
            with Image.open(path) as image:
                width, height = image.size
        except (OSError, SyntaxError, ValueError):
            # Files uploaded by older versions were validated by signature only.
            # Keep them usable while reporting missing dimensions for maintenance.
            width = height = None
    elif media_kind in {"audio", "video"} and TinyTag is not None:
        try:
            tag = TinyTag.get(path)
            if tag.duration is not None:
                duration_ms = max(0, round(float(tag.duration) * 1000))
        except (OSError, ValueError):
            duration_ms = None
    return digest.hexdigest(), width, height, duration_ms


class GalgameProjectAssets:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.storage = AssetStorage(settings)
        self.library = AssetLibrary(session, settings)

    async def _project(self, project_id: str) -> GalgameWorkshopProject:
        row = await self.session.get(GalgameWorkshopProject, project_id)
        if row is None:
            raise GalgameWorkshopProjectNotFoundError("项目不存在")
        return row

    async def _metadata_for(self, asset_id: str) -> GalgameAssetMetadata | None:
        return await self.session.get(GalgameAssetMetadata, asset_id)

    async def _create_metadata(
        self, row: VisualAsset, *, category: str, virtual_path: str
    ) -> GalgameAssetMetadata:
        checksum, width, height, duration_ms = _file_metadata(
            self.storage.path_for(row), row.media_kind
        )
        metadata = GalgameAssetMetadata(
            asset_id=row.id,
            project_id=row.galgame_project_id,
            category=category,
            virtual_path=virtual_path,
            checksum_sha256=checksum,
            width=width,
            height=height,
            duration_ms=duration_ms,
            transcript_status="pending" if row.media_kind == "audio" else "ready",
        )
        self.session.add(metadata)
        await self.session.commit()
        await self.session.refresh(metadata)
        return metadata

    async def import_preview(
        self, project_id: str, filenames: list[str], category: str
    ) -> GalgameAssetImportPreviewOut:
        await self._project(project_id)
        directory = CATEGORY_DIRECTORIES[category]
        existing_paths = list(
            (
                await self.session.execute(
                    select(GalgameAssetMetadata.virtual_path).where(
                        GalgameAssetMetadata.project_id == project_id
                    )
                )
            )
            .scalars()
            .all()
        )
        used = {
            PurePosixPath(path).name.casefold()
            for path in existing_paths
            if PurePosixPath(path).parent.as_posix() == directory
        }
        items: list[GalgameAssetImportPreviewItem] = []
        for raw_name in filenames:
            normalized, reasons = normalize_import_filename(raw_name)
            final_name, renamed_for_duplicate = _deduplicated_name(normalized, used)
            if renamed_for_duplicate:
                reasons.append("同名文件已追加序号")
            items.append(
                GalgameAssetImportPreviewItem(
                    originalName=raw_name,
                    finalName=final_name,
                    virtualPath=f"{directory}/{final_name}",
                    reasons=reasons,
                )
            )
        return GalgameAssetImportPreviewOut(items=items)

    async def list(self, project_id: str, *, query: str = "") -> GalgameProjectAssetListOut:
        await self._project(project_id)
        conditions = [VisualAsset.galgame_project_id == project_id]
        if query:
            conditions.append(VisualAsset.display_name.ilike(f"%{query}%"))
        rows = (
            await self.session.execute(
                select(VisualAsset, GalgameAssetMetadata)
                .outerjoin(GalgameAssetMetadata, GalgameAssetMetadata.asset_id == VisualAsset.id)
                .where(*conditions)
                .order_by(VisualAsset.updated_at.desc(), VisualAsset.created_at.desc())
            )
        ).all()
        return GalgameProjectAssetListOut(
            items=[galgame_asset_out(row, metadata) for row, metadata in rows]
        )

    async def upload(
        self, project_id: str, upload: UploadFile, *, category: str | None = None
    ) -> GalgameProjectAssetOut:
        await self._project(project_id)
        selected_category = category or (
            "video"
            if Path(upload.filename or "").suffix.lower() in {".mp4", ".webm", ".mov"}
            else "font"
            if Path(upload.filename or "").suffix.lower() in {".ttf", ".otf", ".woff", ".woff2"}
            else "other"
        )
        preview = await self.import_preview(
            project_id, [upload.filename or "asset"], selected_category
        )
        planned = preview.items[0]
        upload.filename = planned.final_name
        row = await self.library.store_upload(
            upload,
            galgame_project_id=project_id,
            allowed_extensions=GALGAME_EXTENSIONS,
        )
        metadata = await self._create_metadata(
            row, category=selected_category, virtual_path=planned.virtual_path
        )
        return galgame_asset_out(row, metadata)

    async def batch_upload(
        self, project_id: str, uploads: list[UploadFile], category: str
    ) -> GalgameAssetBatchUploadOut:
        if not uploads:
            raise AssetError("至少选择一个文件", code="empty_upload")
        preview = await self.import_preview(
            project_id, [upload.filename or "asset" for upload in uploads], category
        )
        items: list[GalgameProjectAssetOut] = []
        for upload, planned in zip(uploads, preview.items, strict=True):
            upload.filename = planned.final_name
            row = await self.library.store_upload(
                upload,
                galgame_project_id=project_id,
                allowed_extensions=GALGAME_EXTENSIONS,
            )
            metadata = await self._create_metadata(
                row, category=category, virtual_path=planned.virtual_path
            )
            items.append(galgame_asset_out(row, metadata))
        return GalgameAssetBatchUploadOut(items=items, importItems=preview.items)

    async def patch(
        self, project_id: str, asset_id: str, body: GalgameProjectAssetPatchIn
    ) -> GalgameProjectAssetOut:
        await self._project(project_id)
        row = await self.session.get(VisualAsset, asset_id)
        if row is None or row.galgame_project_id != project_id:
            raise AssetError("工程素材不存在", code="not_found", status=404)
        metadata = await self._metadata_for(asset_id)
        if metadata is None:
            metadata = await self._create_metadata(
                row,
                category=_default_category(row),
                virtual_path=_default_virtual_path(row),
            )
        display_name = (body.display_name or row.display_name).strip()
        category = body.category or metadata.category
        if body.virtual_path is not None:
            virtual_path = body.virtual_path.replace("\\", "/").strip().strip("/")
        else:
            suffix = Path(row.original_filename).suffix.lower()
            filename = f"{display_name}{suffix}"
            directory = (
                CATEGORY_DIRECTORIES[category]
                if body.category is not None
                else PurePosixPath(metadata.virtual_path).parent.as_posix()
            )
            virtual_path = f"{directory}/{filename}"
        path = PurePosixPath(virtual_path)
        if path.is_absolute() or ".." in path.parts or len(path.parts) < 2:
            raise AssetError("虚拟路径必须是安全的项目相对路径", code="invalid_virtual_path")
        collision = await self.session.scalar(
            select(GalgameAssetMetadata.asset_id)
            .where(
                GalgameAssetMetadata.project_id == project_id,
                GalgameAssetMetadata.virtual_path == virtual_path,
                GalgameAssetMetadata.asset_id != asset_id,
            )
            .limit(1)
        )
        if collision:
            raise AssetError("虚拟路径已被其他文件使用", code="virtual_path_conflict", status=409)
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
        }
        if body.display_name is not None:
            values["display_name"] = display_name
        result = await self.session.execute(
            update(VisualAsset)
            .where(
                VisualAsset.id == asset_id,
                VisualAsset.galgame_project_id == project_id,
                VisualAsset.revision == body.expected_revision,
            )
            .values(**values)
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.session.get(VisualAsset, asset_id)
            if current is None or current.galgame_project_id != project_id:
                raise AssetError("工程素材不存在", code="not_found", status=404)
            current_metadata = await self._metadata_for(asset_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                galgame_asset_out(current, current_metadata).model_dump(mode="json", by_alias=True),
            )
        metadata.category = category
        metadata.virtual_path = virtual_path
        if body.packaging_policy is not None:
            metadata.packaging_policy = body.packaging_policy
        await self.session.commit()
        await self.session.refresh(row)
        await self.session.refresh(metadata)
        return galgame_asset_out(row, metadata)

    async def scan_metadata(self, project_id: str) -> GalgameProjectAssetListOut:
        await self._project(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(VisualAsset.galgame_project_id == project_id)
                )
            )
            .scalars()
            .all()
        )
        items: list[GalgameProjectAssetOut] = []
        for row in rows:
            metadata = await self._metadata_for(row.id)
            if metadata is None:
                metadata = await self._create_metadata(
                    row,
                    category=_default_category(row),
                    virtual_path=_default_virtual_path(row),
                )
            path = self.storage.path_for(row)
            if path.is_file():
                checksum, width, height, duration_ms = _file_metadata(path, row.media_kind)
                metadata.checksum_sha256 = checksum
                metadata.width = width
                metadata.height = height
                metadata.duration_ms = duration_ms
            items.append(galgame_asset_out(row, metadata))
        await self.session.commit()
        return GalgameProjectAssetListOut(items=items)

    async def overview(self, project_id: str) -> GalgameAssetOverviewOut:
        await self._project(project_id)
        story_row = await self.session.get(GalgameStoryDocument, project_id)
        document = normalize_story_document(story_row.document) if story_row else None
        referenced_file_ids = (
            {asset.file_id for asset in document.assets} if document is not None else set()
        )
        asset_scope = VisualAsset.galgame_project_id == project_id
        if referenced_file_ids:
            asset_scope = or_(asset_scope, VisualAsset.id.in_(referenced_file_ids))
        rows_with_metadata = (
            await self.session.execute(
                select(VisualAsset, GalgameAssetMetadata)
                .outerjoin(GalgameAssetMetadata, GalgameAssetMetadata.asset_id == VisualAsset.id)
                .where(asset_scope)
                .order_by(VisualAsset.updated_at.desc(), VisualAsset.created_at.desc())
            )
        ).all()
        rows = [row for row, _metadata in rows_with_metadata]
        if document is None:
            items = [
                GalgameAssetOverviewItem(
                    **{
                        **galgame_asset_out(row, metadata).model_dump(),
                        "category": metadata.category if metadata else _default_category(row),
                    },
                    orphaned=True,
                )
                for row, metadata in rows_with_metadata
            ]
            return GalgameAssetOverviewOut(
                totalBytes=sum(item.byte_size for item in items),
                orphanedCount=len(items),
                typeDistribution={
                    kind: sum(1 for item in items if item.category == kind)
                    for kind in sorted({item.category for item in items})
                },
                items=[item for item in items],
                missing_items=[],
            )
        story_assets_by_file = {asset.file_id: asset for asset in document.assets}
        row_ids = {row.id for row in rows}
        category_by_role = {
            "characterPortrait": "character",
            "sceneLayer": "scene",
            "dialogueAvatar": "character",
            "characterOverlay": "character",
            "storyCg": "cg",
            "backgroundMusic": "bgm",
            "ambientSound": "ambient",
            "soundEffect": "sfx",
            "voiceSample": "voice",
            "voiceLine": "voice",
            "video": "video",
        }
        items: list[GalgameAssetOverviewItem] = []
        metadata_by_id = {row.id: metadata for row, metadata in rows_with_metadata}
        for row in rows:
            metadata = metadata_by_id[row.id]
            story_asset = story_assets_by_file.get(row.id)
            raw_references = await self._story_references(project_id, row.id)
            meaningful = [item for item in raw_references if item.get("kind") != "storyAsset"]
            bound_character_ids = sorted(
                {
                    str(item["characterId"])
                    for item in meaningful
                    if item.get("characterId") is not None
                }
            )
            role = getattr(story_asset, "role", None)
            category = (
                metadata.category
                if metadata is not None
                else category_by_role.get(role, _default_category(row))
            )
            items.append(
                GalgameAssetOverviewItem(
                    **{
                        **galgame_asset_out(row, metadata).model_dump(),
                        "category": category,
                    },
                    story_asset_id=getattr(story_asset, "id", None),
                    story_role=role,
                    bound_character_ids=bound_character_ids,
                    reference_count=len(meaningful),
                    references=[
                        GalgameAssetReferenceLocation.model_validate(item) for item in meaningful
                    ],
                    orphaned=story_asset is None or not meaningful,
                )
            )
        missing_items: list[GalgameMissingAssetOverviewItem] = []
        for asset in document.assets:
            if asset.file_id in row_ids:
                continue
            references = await self._story_references(project_id, asset.file_id)
            missing_items.append(
                GalgameMissingAssetOverviewItem(
                    story_asset_id=asset.id,
                    file_id=asset.file_id,
                    story_role=asset.role,
                    references=[
                        GalgameAssetReferenceLocation.model_validate(item)
                        for item in references
                        if item.get("kind") != "storyAsset"
                    ],
                )
            )
        manifest = await self.package_manifest(project_id)
        distribution = {
            category: sum(1 for item in items if item.category == category)
            for category in sorted({item.category for item in items})
        }
        health_categories = {"character", "scene", "cg", "bgm", "sfx", "voice", "video"}
        module_health = {
            category: (
                "error"
                if any(
                    missing.story_role and category_by_role.get(missing.story_role) == category
                    for missing in missing_items
                )
                else "ready"
            )
            for category in health_categories
        }
        return GalgameAssetOverviewOut(
            items=items,
            missing_items=missing_items,
            totalBytes=sum(item.byte_size for item in items),
            referencedCount=sum(1 for item in items if item.reference_count > 0),
            orphanedCount=sum(1 for item in items if item.orphaned),
            estimatedPackageBytes=manifest.total_bytes,
            typeDistribution=distribution,
            largestAssetIds=[
                item.id for item in sorted(items, key=lambda item: item.byte_size, reverse=True)[:5]
            ],
            moduleHealth=module_health,
        )

    async def _story_references(self, project_id: str, file_id: str) -> list[dict[str, object]]:
        row = await self.session.get(GalgameStoryDocument, project_id)
        if row is None:
            return []
        document = normalize_story_document(row.document)
        story_assets = [asset for asset in document.assets if asset.file_id == file_id]
        story_asset_ids = {asset.id for asset in story_assets}
        cg_variant_assets = {
            (cg.id, variant.id): variant.asset_id for cg in document.cgs for variant in cg.variants
        }
        cg_defaults = {cg.id: cg.default_variant_id for cg in document.cgs}
        references: list[dict[str, object]] = []
        for character in document.characters:
            for expression in character.expressions:
                if expression.asset_id in story_asset_ids:
                    references.append(
                        {
                            "kind": "characterExpression",
                            "characterId": character.id,
                            "storyAssetId": expression.asset_id,
                            "label": f"角色“{character.name}”· {expression.label}",
                        }
                    )
                if expression.sequence is not None:
                    for frame_index, frame in enumerate(expression.sequence.frames):
                        if frame.asset_id not in story_asset_ids:
                            continue
                        references.append(
                            {
                                "kind": "characterExpressionFrame",
                                "characterId": character.id,
                                "storyAssetId": frame.asset_id,
                                "label": (
                                    f"角色“{character.name}”· {expression.label}"
                                    f" · 第 {frame_index + 1} 帧"
                                ),
                            }
                        )
                if expression.dialogue_avatar.asset_id in story_asset_ids:
                    references.append(
                        {
                            "kind": "dialogueAvatar",
                            "characterId": character.id,
                            "storyAssetId": expression.dialogue_avatar.asset_id,
                            "label": f"角色“{character.name}”· {expression.label}对白头像",
                        }
                    )
                for overlay in expression.overlays:
                    if overlay.asset_id not in story_asset_ids:
                        continue
                    references.append(
                        {
                            "kind": "characterOverlay",
                            "characterId": character.id,
                            "storyAssetId": overlay.asset_id,
                            "label": f"角色“{character.name}”· {expression.label}· {overlay.name}",
                        }
                    )
            for skin in character.portrait_skins:
                for override in skin.overrides:
                    if override.asset_id not in story_asset_ids:
                        continue
                    references.append(
                        {
                            "kind": "portraitSkin",
                            "characterId": character.id,
                            "storyAssetId": override.asset_id,
                            "label": (f"角色“{character.name}”· 皮肤“{skin.name}”"),
                        }
                    )
        dialogue_box_asset_id = document.presentation.dialogue_box.asset_id
        if dialogue_box_asset_id in story_asset_ids:
            references.append(
                {
                    "kind": "dialogueBoxStyle",
                    "storyAssetId": dialogue_box_asset_id,
                    "label": "个性化 · 对话框底图",
                }
            )
        for component in document.presentation.ui.components:
            if component.asset_id not in story_asset_ids:
                continue
            references.append(
                {
                    "kind": "uiComponent",
                    "storyAssetId": component.asset_id,
                    "label": f"个性化 · 界面组件“{component.name}”",
                }
            )
        for style in document.presentation.system_message.custom_styles:
            if style.asset_id not in story_asset_ids:
                continue
            references.append(
                {
                    "kind": "systemMessageStyle",
                    "storyAssetId": style.asset_id,
                    "label": f"个性化 · 消息框样式“{style.name}”",
                }
            )
        for scene in document.scenes:
            for layer in scene.layers:
                if layer.asset_id not in story_asset_ids:
                    continue
                references.append(
                    {
                        "kind": "sceneLayer",
                        "sceneId": scene.id,
                        "storyAssetId": layer.asset_id,
                        "label": f"场景“{scene.name}”· {layer.name}",
                    }
                )
        for cg in document.cgs:
            for variant in cg.variants:
                if variant.asset_id not in story_asset_ids:
                    continue
                references.append(
                    {
                        "kind": "cgVariant",
                        "cgId": cg.id,
                        "variantId": variant.id,
                        "storyAssetId": variant.asset_id,
                        "label": f"剧情 CG“{cg.name}”· {variant.label}",
                    }
                )
        for character in document.characters:
            profile = character.voice_profile
            if profile is not None and profile.sample_asset_id in story_asset_ids:
                references.append(
                    {
                        "kind": "characterVoiceSample",
                        "characterId": character.id,
                        "storyAssetId": profile.sample_asset_id,
                        "label": f"角色“{character.name}”的声线样本",
                    }
                )
        for chapter in document.chapters:
            for fragment in chapter.fragments:
                for block in fragment.blocks:
                    asset_id = None
                    kind = ""
                    if (
                        isinstance(block, GalgameStoryDialogueBlock)
                        and block.voice_asset_id in story_asset_ids
                    ):
                        asset_id = block.voice_asset_id
                        kind = "dialogueVoice"
                    elif (
                        isinstance(block, GalgameStoryAudioBlock)
                        and block.asset_id in story_asset_ids
                    ):
                        asset_id = block.asset_id
                        kind = "audioBlock"
                    elif isinstance(block, GalgameStoryShowCgBlock):
                        variant_id = block.variant_id or cg_defaults.get(block.cg_id)
                        cg_asset_id = cg_variant_assets.get((block.cg_id, variant_id or ""))
                        if cg_asset_id in story_asset_ids:
                            asset_id = cg_asset_id
                            kind = "showCg"
                    elif (
                        isinstance(block, GalgameStoryVideoBlock)
                        and block.asset_id in story_asset_ids
                    ):
                        asset_id = block.asset_id
                        kind = "videoBlock"
                    if asset_id is None:
                        continue
                    reference: dict[str, object] = {
                        "kind": kind,
                        "chapterId": chapter.id,
                        "fragmentId": fragment.id,
                        "blockId": block.id,
                        "storyAssetId": asset_id,
                        "label": (
                            f"{chapter.title} · {fragment.title} · "
                            f"Block {fragment.blocks.index(block) + 1}"
                        ),
                    }
                    if isinstance(block, GalgameStoryShowCgBlock):
                        reference["cgId"] = block.cg_id
                        reference["variantId"] = block.variant_id or cg_defaults.get(block.cg_id)
                    references.append(reference)
        used_story_asset_ids = {
            str(reference["storyAssetId"])
            for reference in references
            if reference.get("storyAssetId") is not None
        }
        for asset in story_assets:
            if asset.id in used_story_asset_ids:
                continue
            references.append(
                {
                    "kind": "storyAsset",
                    "storyAssetId": asset.id,
                    "label": getattr(asset, "label", None) or "故事素材库",
                }
            )
        return references

    async def package_manifest(self, project_id: str) -> GalgamePackageManifestOut:
        await self._project(project_id)
        story_row = await self.session.get(GalgameStoryDocument, project_id)
        document = normalize_story_document(story_row.document) if story_row else None
        rows_with_metadata = (
            await self.session.execute(
                select(VisualAsset, GalgameAssetMetadata)
                .outerjoin(GalgameAssetMetadata, GalgameAssetMetadata.asset_id == VisualAsset.id)
                .where(VisualAsset.galgame_project_id == project_id)
            )
        ).all()
        if document is not None:
            known_ids = {row.id for row, _metadata in rows_with_metadata}
            external_ids = {asset.file_id for asset in document.assets} - known_ids
            if external_ids:
                external_rows = (
                    await self.session.execute(
                        select(VisualAsset, GalgameAssetMetadata)
                        .outerjoin(
                            GalgameAssetMetadata,
                            GalgameAssetMetadata.asset_id == VisualAsset.id,
                        )
                        .where(VisualAsset.id.in_(external_ids))
                    )
                ).all()
                rows_with_metadata.extend(external_rows)
        items: list[GalgamePackageManifestItem] = []
        issues: list[GalgamePackageManifestIssue] = []
        seen_paths: dict[str, str] = {}
        row_ids = {row.id for row, _metadata in rows_with_metadata}
        story_assets_by_file = (
            {asset.file_id: asset for asset in document.assets} if document is not None else {}
        )
        for row, metadata in rows_with_metadata:
            references = await self._story_references(project_id, row.id)
            referenced = any(item.get("kind") != "storyAsset" for item in references)
            policy: GalgameAssetPackagingPolicy = (
                metadata.packaging_policy if metadata is not None else "auto"
            )
            virtual_path = (
                metadata.virtual_path if metadata is not None else _default_virtual_path(row)
            )
            path_exists = self.storage.path_for(row).is_file()
            if referenced and policy == "exclude":
                issues.append(
                    GalgamePackageManifestIssue(
                        code="referenced_asset_excluded",
                        assetId=row.id,
                        storyAssetId=getattr(story_assets_by_file.get(row.id), "id", None),
                        message="被剧本引用的素材已设为强制排除",
                    )
                )
            if referenced and not path_exists:
                issues.append(
                    GalgamePackageManifestIssue(
                        code="missing_asset_file",
                        assetId=row.id,
                        storyAssetId=getattr(story_assets_by_file.get(row.id), "id", None),
                        message="被剧本引用的素材文件不存在",
                    )
                )
            include = policy == "include" or (policy == "auto" and referenced)
            if not include or policy == "exclude" or not path_exists:
                continue
            previous = seen_paths.get(virtual_path.casefold())
            if previous is not None:
                issues.append(
                    GalgamePackageManifestIssue(
                        code="duplicate_virtual_path",
                        assetId=row.id,
                        message=f"虚拟路径与素材 {previous} 冲突",
                    )
                )
                continue
            seen_paths[virtual_path.casefold()] = row.id
            items.append(
                GalgamePackageManifestItem(
                    assetId=row.id,
                    virtualPath=virtual_path,
                    byteSize=row.byte_size,
                    reason="forced" if policy == "include" else "referenced",
                )
            )
        if document is not None:
            for asset in document.assets:
                if asset.file_id in row_ids:
                    continue
                references = await self._story_references(project_id, asset.file_id)
                if any(item.get("kind") != "storyAsset" for item in references):
                    issues.append(
                        GalgamePackageManifestIssue(
                            code="missing_asset_record",
                            storyAssetId=asset.id,
                            message="被剧本引用的素材记录不存在",
                        )
                    )
        items.sort(key=lambda item: item.virtual_path.casefold())
        return GalgamePackageManifestOut(
            ready=not issues,
            totalBytes=sum(item.byte_size for item in items),
            items=items,
            issues=issues,
        )

    async def delete(self, project_id: str, asset_id: str, expected_revision: int) -> Path:
        await self._project(project_id)
        row = await self.session.get(VisualAsset, asset_id)
        if row is None or row.galgame_project_id != project_id:
            raise AssetError("工程素材不存在", code="not_found", status=404)
        reference = await self.session.scalar(
            select(GalgameProjectAssetReference.id)
            .where(GalgameProjectAssetReference.asset_id == asset_id)
            .limit(1)
        )
        if reference:
            references = await self._story_references(project_id, asset_id)
            raise AssetError(
                "素材仍被故事使用，请先移除相关引用",
                code="asset_in_use",
                status=409,
                detail={"references": references},
            )
        path = self.storage.path_for(row)
        result = await self.session.execute(
            delete(VisualAsset).where(
                VisualAsset.id == asset_id,
                VisualAsset.galgame_project_id == project_id,
                VisualAsset.revision == expected_revision,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.session.get(VisualAsset, asset_id)
            if current is None or current.galgame_project_id != project_id:
                raise AssetError("工程素材不存在", code="not_found", status=404)
            raise RevisionConflictError(
                expected_revision,
                current.revision,
                galgame_asset_out(current).model_dump(mode="json"),
            )
        await self.session.commit()
        path.unlink(missing_ok=True)
        return path

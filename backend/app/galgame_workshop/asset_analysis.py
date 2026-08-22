from __future__ import annotations

from sqlalchemy import or_, select

from app.galgame_workshop.asset_support import (
    _default_category,
    _default_virtual_path,
    galgame_asset_out,
)
from app.galgame_workshop.story import normalize_story_document
from app.models import GalgameAssetMetadata, GalgameStoryDocument, VisualAsset
from app.schemas.galgame_workshop import (
    GalgameAssetOverviewItem,
    GalgameAssetOverviewOut,
    GalgameAssetPackagingPolicy,
    GalgameAssetReferenceLocation,
    GalgameMissingAssetOverviewItem,
    GalgamePackageManifestIssue,
    GalgamePackageManifestItem,
    GalgamePackageManifestOut,
    GalgameStoryAudioBlock,
    GalgameStoryDialogueBlock,
    GalgameStoryShowCgBlock,
    GalgameStoryVideoBlock,
)


class GalgameAssetAnalysisMixin:
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
            "timelineMaster": "voice",
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
                master_asset_id = (
                    fragment.timeline.master_audio.asset_id
                    if fragment.timeline is not None and fragment.timeline.master_audio is not None
                    else None
                )
                if master_asset_id in story_asset_ids:
                    references.append(
                        {
                            "kind": "timelineMaster",
                            "chapterId": chapter.id,
                            "fragmentId": fragment.id,
                            "storyAssetId": master_asset_id,
                            "label": f"{chapter.title} · {fragment.title} · 时间轴主音轨",
                        }
                    )
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

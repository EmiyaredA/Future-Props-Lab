from __future__ import annotations

# ruff: noqa: F405
import hashlib
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.galgame_workshop.base import _clean_title
from app.schemas.galgame_workshop.blocks import *  # noqa: F403
from app.schemas.galgame_workshop.stage_settings import GalgameStorySettings


class GalgameStoryFragmentTimeline(GalgameStoryModel):
    duration_ms: int = Field(
        alias="durationMs",
        ge=1,
        description="剧情时间轴总长（毫秒）",
    )


class GalgameStoryFragment(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    title: str = Field(min_length=1, max_length=120)
    timeline: GalgameStoryFragmentTimeline | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    blocks: list[GalgameStoryBlock] = Field(default_factory=list, max_length=1000)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryChapter(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    title: str = Field(min_length=1, max_length=120)
    order: int = Field(ge=1, le=1000)
    entry_fragment_id: str = Field(alias="entryFragmentId", pattern=STABLE_ID_PATTERN)
    disabled: bool | None = None
    fragments: list[GalgameStoryFragment] = Field(default_factory=list, max_length=500)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @field_validator("disabled", mode="before")
    @classmethod
    def disabled_defaults_to_false(cls, value: Any) -> bool:
        return False if value is None else value


class GalgameStoryProject(GalgameStoryModel):
    schema_version: Literal["1.3"] = Field(alias="schemaVersion")
    synopsis: str = Field(default="", max_length=10_000)
    entry_chapter_id: str | None = Field(
        default=None, alias="entryChapterId", pattern=STABLE_ID_PATTERN
    )
    characters: list[GalgameStoryCharacter] = Field(default_factory=list, max_length=200)
    character_attribute_templates: list[GalgameStoryCharacterAttributeTemplate] = Field(
        default_factory=list, alias="characterAttributeTemplates", max_length=200
    )
    scene_groups: list[GalgameStorySceneGroup] = Field(
        default_factory=list, alias="sceneGroups", max_length=100
    )
    scenes: list[GalgameStoryScene] = Field(default_factory=list, max_length=200)
    cgs: list[GalgameStoryCg] = Field(default_factory=list, max_length=200)
    variables: list[GalgameStoryVariable] = Field(default_factory=list, max_length=500)
    assets: list[GalgameStoryAsset] = Field(default_factory=list, max_length=2000)
    presentation: GalgameStoryPresentation = Field(default_factory=GalgameStoryPresentation)
    settings: GalgameStorySettings = Field(default_factory=GalgameStorySettings)
    chapters: list[GalgameStoryChapter] = Field(default_factory=list, min_length=1, max_length=100)

    @model_validator(mode="before")
    @classmethod
    def migrate_v1_defaults(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        migrated = dict(value)
        source_version = migrated.get("schemaVersion")
        if source_version in {None, "1.0", "1.1", "1.2"}:
            migrated["schemaVersion"] = "1.3"
        chapters = [dict(chapter) for chapter in migrated.get("chapters", [])]
        for chapter in chapters:
            chapter.setdefault("disabled", False)
        migrated["chapters"] = chapters
        if not migrated.get("entryChapterId") and chapters:
            first = min(chapters, key=lambda chapter: chapter.get("order", 1))
            migrated["entryChapterId"] = first.get("id")
        migrated.setdefault("characterAttributeTemplates", [])
        characters = [dict(character) for character in migrated.get("characters", [])]
        for index, character in enumerate(characters):
            character.setdefault(
                "themeColor",
                CHARACTER_THEME_PALETTE[index % len(CHARACTER_THEME_PALETTE)],
            )
            legacy_avatar = dict(character.get("dialogueAvatar") or {})
            legacy_crop = legacy_avatar.pop("crop", None)
            character["dialogueAvatar"] = legacy_avatar
            expressions = [dict(expression) for expression in character.get("expressions", [])]
            if legacy_crop is not None:
                for expression in expressions:
                    expression.setdefault(
                        "dialogueAvatar",
                        {"source": "portrait", "crop": legacy_crop},
                    )
            character["expressions"] = expressions
        migrated["characters"] = characters
        settings = dict(migrated.get("settings") or {})
        character_stage = dict(settings.get("characterStage") or {})
        legacy_scale = character_stage.pop("defaultScale", None)
        if legacy_scale is not None:
            character_stage.setdefault("legacyDefaultScale", legacy_scale)
        character_stage.setdefault("defaultHeightPercent", 100)
        if "positionPresets" not in character_stage:
            has_legacy_positions = any(
                key in character_stage for key in ("positions", "anchorX", "anchorY")
            )
            legacy_positions = dict(character_stage.pop("positions", {}) or {})
            legacy_y = character_stage.pop("anchorY", 100 if has_legacy_positions else 50)
            character_stage.pop("anchorX", None)
            position_defaults = (
                ("position-left", "左", "left", 25),
                ("position-center-left", "中左", "centerLeft", 37.5),
                ("position-center", "中", "center", 50),
                ("position-center-right", "中右", "centerRight", 62.5),
                ("position-right", "右", "right", 75),
            )
            character_stage["positionPresets"] = [
                {
                    "id": preset_id,
                    "name": name,
                    "x": legacy_positions.get(key, default_x),
                    "y": legacy_y,
                    "builtinKey": key,
                }
                for preset_id, name, key, default_x in position_defaults
            ]
        character_stage.setdefault("defaultPositionId", "position-center")
        character_stage.setdefault("anchor", "center")
        settings["characterStage"] = character_stage
        migrated["settings"] = settings

        assets = [dict(asset) for asset in migrated.get("assets", [])]
        for asset in assets:
            if asset.get("role") == "sceneBackground":
                asset["role"] = "sceneLayer"
        migrated["assets"] = assets

        migrated.setdefault("sceneGroups", [])
        if source_version in {None, "1.0", "1.1"}:
            used_scene_ids = {
                str(scene.get("id")) for scene in migrated.get("scenes", []) if scene.get("id")
            }
            split_scene_ids: dict[tuple[str, str], str] = {}
            normalized_scenes: list[dict[str, Any]] = []
            for raw_scene in migrated.get("scenes", []):
                scene = dict(raw_scene)
                backgrounds = [dict(item) for item in scene.pop("backgrounds", [])]
                default_background_id = scene.pop("defaultBackgroundId", None)
                if not backgrounds:
                    scene.setdefault("layers", [])
                    normalized_scenes.append(scene)
                    continue
                default_background = next(
                    (item for item in backgrounds if item.get("id") == default_background_id),
                    backgrounds[0],
                )
                ordered = [default_background] + [
                    item for item in backgrounds if item is not default_background
                ]
                for item_index, background in enumerate(ordered):
                    scene_id = str(scene.get("id", "scene"))
                    background_id = str(background.get("id", f"layer-{item_index + 1}"))
                    if item_index == 0:
                        target_scene_id = scene_id
                    else:
                        digest = hashlib.sha1(f"{scene_id}:{background_id}".encode()).hexdigest()[
                            :10
                        ]
                        prefix = f"{scene_id}-{background_id}"[:53].rstrip("-")
                        target_scene_id = f"{prefix}-{digest}"
                        if target_scene_id in used_scene_ids:
                            target_scene_id = f"{scene_id[:52].rstrip('-')}-{digest}"
                        used_scene_ids.add(target_scene_id)
                    split_scene_ids[(scene_id, background_id)] = target_scene_id
                    split_scene = dict(scene)
                    split_scene["id"] = target_scene_id
                    if item_index:
                        suffix = str(background.get("label") or background_id)
                        split_scene["name"] = f"{scene.get('name', scene_id)} · {suffix}"[:120]
                    split_scene["layers"] = [
                        {
                            "id": background_id,
                            "name": str(background.get("label") or background_id),
                            "assetId": background.get("assetId"),
                            "distance": 1,
                            "offsetX": 0,
                            "offsetY": 0,
                        }
                    ]
                    normalized_scenes.append(split_scene)
            migrated["scenes"] = normalized_scenes
            for chapter in migrated.get("chapters", []):
                for fragment in chapter.get("fragments", []):
                    for block in fragment.get("blocks", []):
                        if block.get("type") != "scene":
                            continue
                        scene_id = str(block.get("sceneId", ""))
                        background_id = block.pop("backgroundId", None)
                        if background_id is not None:
                            block["sceneId"] = split_scene_ids.get(
                                (scene_id, str(background_id)), scene_id
                            )
        return migrated

    @model_validator(mode="after")
    def references_and_ids_are_valid(self) -> GalgameStoryProject:
        character_ids = [character.id for character in self.characters]
        scene_group_ids = [group.id for group in self.scene_groups]
        scene_ids = [scene.id for scene in self.scenes]
        cg_ids = [cg.id for cg in self.cgs]
        chapter_ids = [chapter.id for chapter in self.chapters]
        chapter_orders = [chapter.order for chapter in self.chapters]
        asset_ids = [asset.id for asset in self.assets]
        variable_ids = [variable.id for variable in self.variables]
        attribute_ids = [attribute.id for attribute in self.character_attribute_templates]
        if len(character_ids) != len(set(character_ids)):
            raise ValueError("角色 ID 不能重复")
        if len(scene_group_ids) != len(set(scene_group_ids)):
            raise ValueError("场景分组 ID 不能重复")
        if len(scene_ids) != len(set(scene_ids)):
            raise ValueError("场景 ID 不能重复")
        if len(cg_ids) != len(set(cg_ids)):
            raise ValueError("CG ID 不能重复")
        if len(chapter_ids) != len(set(chapter_ids)):
            raise ValueError("章节 ID 不能重复")
        if len(chapter_orders) != len(set(chapter_orders)):
            raise ValueError("章节顺序不能重复")
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("素材 ID 不能重复")
        if len(variable_ids) != len(set(variable_ids)):
            raise ValueError("变量 ID 不能重复")
        if len(attribute_ids) != len(set(attribute_ids)):
            raise ValueError("角色属性模板 ID 不能重复")
        if self.entry_chapter_id not in set(chapter_ids):
            raise ValueError("入口章节不存在")
        if next(
            chapter for chapter in self.chapters if chapter.id == self.entry_chapter_id
        ).disabled:
            raise ValueError("入口章节不能禁用")

        known_characters = set(character_ids)
        known_variables = set(variable_ids)
        variables_by_id = {variable.id: variable for variable in self.variables}
        known_attributes = set(attribute_ids)
        attribute_types = {
            attribute.id: attribute.type for attribute in self.character_attribute_templates
        }
        known_scenes = set(scene_ids)
        known_scene_groups = set(scene_group_ids)
        cgs_by_id = {cg.id: cg for cg in self.cgs}
        assets_by_id = {asset.id: asset for asset in self.assets}
        expressions_by_character: dict[str, set[str]] = {}
        for character in self.characters:
            if not set(character.attributes).issubset(known_attributes):
                raise ValueError("角色包含未声明的属性")
            for attribute_id, attribute_value in character.attributes.items():
                expected = attribute_types[attribute_id]
                valid = {
                    "string": isinstance(attribute_value, str),
                    "number": isinstance(attribute_value, (int, float))
                    and not isinstance(attribute_value, bool),
                    "boolean": isinstance(attribute_value, bool),
                }[expected]
                if not valid:
                    raise ValueError("角色属性值与模板类型不一致")
            expressions_by_character[character.id] = {
                expression.id for expression in character.expressions
            }
            for display_name in character.display_names:
                if display_name.source == "variable":
                    variable = variables_by_id.get(display_name.variable_id or "")
                    if variable is None:
                        raise ValueError("角色显示名引用了不存在的变量")
                    if variable.type != "string":
                        raise ValueError("角色显示名只能引用字符串变量")
                elif display_name.source == "attribute":
                    if display_name.attribute_id not in known_attributes:
                        raise ValueError("角色显示名引用了不存在的角色属性")
                    if attribute_types[display_name.attribute_id or ""] != "string":
                        raise ValueError("角色显示名只能引用字符串角色属性")
            for expression in character.expressions:
                asset = assets_by_id.get(expression.asset_id)
                if asset is None:
                    raise ValueError("角色表情引用了不存在的立绘素材")
                if asset.role != "characterPortrait":
                    raise ValueError("角色表情只能引用角色立绘素材")
                if expression.dialogue_avatar.asset_id is not None:
                    avatar_asset = assets_by_id.get(expression.dialogue_avatar.asset_id)
                    if avatar_asset is None:
                        raise ValueError("表情对白头像引用了不存在的图片素材")
                    if avatar_asset.role != "dialogueAvatar":
                        raise ValueError("独立对白头像只能引用对白头像素材")
                for overlay in expression.overlays:
                    overlay_asset = assets_by_id.get(overlay.asset_id)
                    if overlay_asset is None:
                        raise ValueError("表情图形覆盖引用了不存在的图片素材")
                    if overlay_asset.role != "characterOverlay":
                        raise ValueError("表情图形覆盖只能引用角色覆盖素材")
            known_expression_ids = expressions_by_character[character.id]
            for skin in character.portrait_skins:
                for override in skin.overrides:
                    if override.expression_id not in known_expression_ids:
                        raise ValueError("立绘皮肤覆盖了不存在的角色表情")
                    asset = assets_by_id.get(override.asset_id)
                    if asset is None:
                        raise ValueError("立绘皮肤引用了不存在的立绘素材")
                    if asset.role != "characterPortrait":
                        raise ValueError("立绘皮肤只能引用角色立绘素材")
            if (
                character.voice_profile is not None
                and character.voice_profile.sample_asset_id is not None
            ):
                sample = assets_by_id.get(character.voice_profile.sample_asset_id)
                if sample is None:
                    raise ValueError("角色声线引用了不存在的试听样本")
                if sample.role != "voiceSample":
                    raise ValueError("角色声线只能引用试听样本素材")
        for scene in self.scenes:
            if scene.group_id is not None and scene.group_id not in known_scene_groups:
                raise ValueError("场景引用了不存在的分组")
            for layer in scene.layers:
                asset = assets_by_id.get(layer.asset_id)
                if asset is None:
                    raise ValueError("场景图层引用了不存在的图片素材")
                if asset.role != "sceneLayer":
                    raise ValueError("场景图层只能引用场景图层素材")
        variants_by_cg: dict[str, set[str]] = {}
        for cg in self.cgs:
            variants_by_cg[cg.id] = {variant.id for variant in cg.variants}
            for variant in cg.variants:
                asset = assets_by_id.get(variant.asset_id)
                if asset is None:
                    raise ValueError("CG 差分引用了不存在的图片素材")
                if asset.role != "storyCg":
                    raise ValueError("CG 差分只能引用剧情 CG 素材")
        dialogue_asset_id = self.presentation.dialogue_box.asset_id
        if dialogue_asset_id is not None:
            dialogue_asset = assets_by_id.get(dialogue_asset_id)
            if dialogue_asset is None:
                raise ValueError("对话框样式引用了不存在的图片素材")
            if dialogue_asset.role != "dialogueBox":
                raise ValueError("对话框样式只能引用对话框底图素材")
        for component in self.presentation.ui.components:
            if component.asset_id is None:
                continue
            ui_asset = assets_by_id.get(component.asset_id)
            if ui_asset is None:
                raise ValueError(f"界面组件“{component.name}”引用了不存在的图片素材")
            if ui_asset.role != "uiComponent":
                raise ValueError(f"界面组件“{component.name}”只能引用界面组件素材")
        for style in self.presentation.system_message.custom_styles:
            if style.asset_id is None:
                continue
            message_asset = assets_by_id.get(style.asset_id)
            if message_asset is None:
                raise ValueError(f"消息框样式“{style.name}”引用了不存在的图片素材")
            if message_asset.role != "uiComponent":
                raise ValueError(f"消息框样式“{style.name}”只能引用界面组件素材")
        block_ids: list[str] = []
        all_fragment_ids: list[str] = []
        ending_ids: list[str] = []
        for chapter in self.chapters:
            fragment_ids = [fragment.id for fragment in chapter.fragments]
            all_fragment_ids.extend(fragment_ids)
            if len(fragment_ids) != len(set(fragment_ids)):
                raise ValueError(f"章节“{chapter.title}”的 Fragment ID 不能重复")
            known_fragments = set(fragment_ids)
            if chapter.entry_fragment_id not in known_fragments:
                raise ValueError(f"章节“{chapter.title}”的入口 Fragment 不存在")
            for fragment in chapter.fragments:
                previous_end_ms = 0
                scene_events_at: dict[int, bool] = {}
                cg_events_at: dict[int, bool] = {}
                character_events_at: dict[int, list[tuple[str, bool]]] = {}
                audio_plays_at: dict[tuple[int, str], bool] = {}
                timed_cues = [
                    (index, block.start_ms)
                    for index, block in enumerate(fragment.blocks)
                    if isinstance(
                        block,
                        (
                            GalgameStoryDialogueBlock,
                            GalgameStoryNarrationBlock,
                            GalgameStoryStoryParagraphBlock,
                            GalgameStorySystemMessageBlock,
                        ),
                    )
                    and block.start_ms is not None
                ]
                for block_index, block in enumerate(fragment.blocks):
                    block_ids.append(block.id)
                    point_time = (
                        block.at_ms
                        if isinstance(
                            block,
                            (
                                GalgameStorySceneBlock,
                                GalgameStoryShowCgBlock,
                                GalgameStoryHideCgBlock,
                                GalgameStoryShowCharacterBlock,
                                GalgameStoryRemoveCharacterBlock,
                                GalgameStoryAudioBlock,
                                GalgameStoryDestroySceneBlock,
                                GalgameStoryCameraBlock,
                                GalgameStoryResetCameraBlock,
                                GalgameStoryParticleBlock,
                                GalgameStoryStageAnimationBlock,
                                GalgameStoryFloatingTextBlock,
                                GalgameStoryCurtainBlock,
                                GalgameStoryVideoBlock,
                                GalgameStoryAnimateSpriteBlock,
                            ),
                        )
                        else None
                    )
                    if fragment.timeline is None:
                        if point_time is not None:
                            raise ValueError("普通 Fragment 的演出事件不能包含时间轴锚点")
                    elif isinstance(
                        block,
                        (
                            GalgameStorySceneBlock,
                            GalgameStoryShowCgBlock,
                            GalgameStoryHideCgBlock,
                            GalgameStoryShowCharacterBlock,
                            GalgameStoryRemoveCharacterBlock,
                            GalgameStoryAudioBlock,
                            GalgameStoryDestroySceneBlock,
                            GalgameStoryCameraBlock,
                            GalgameStoryResetCameraBlock,
                            GalgameStoryParticleBlock,
                            GalgameStoryStageAnimationBlock,
                            GalgameStoryFloatingTextBlock,
                            GalgameStoryCurtainBlock,
                            GalgameStoryVideoBlock,
                            GalgameStoryAnimateSpriteBlock,
                        ),
                    ):
                        if point_time is None:
                            next_cue = next(
                                (
                                    (cue_index, cue_time)
                                    for cue_index, cue_time in timed_cues
                                    if cue_index > block_index
                                ),
                                None,
                            )
                            if isinstance(
                                block,
                                (GalgameStoryShowCharacterBlock, GalgameStoryRemoveCharacterBlock),
                            ):
                                point_time = (
                                    next_cue[1]
                                    if next_cue is not None
                                    else fragment.timeline.duration_ms
                                )
                            else:
                                point_time = (
                                    0
                                    if next_cue is not None
                                    and timed_cues
                                    and timed_cues[0][0] > block_index
                                    else (
                                        next_cue[1]
                                        if next_cue is not None
                                        else fragment.timeline.duration_ms
                                    )
                                )
                        if point_time > fragment.timeline.duration_ms:
                            raise ValueError("演出事件不能超过剧情时间轴总长")
                        explicit_point_time = block.at_ms is not None
                        if isinstance(block, GalgameStorySceneBlock):
                            if point_time in scene_events_at and (
                                explicit_point_time or scene_events_at[point_time]
                            ):
                                raise ValueError("同一时刻只能切换一次场景")
                            scene_events_at[point_time] = (
                                scene_events_at.get(point_time, False) or explicit_point_time
                            )
                        elif isinstance(block, (GalgameStoryShowCgBlock, GalgameStoryHideCgBlock)):
                            if point_time in cg_events_at and (
                                explicit_point_time or cg_events_at[point_time]
                            ):
                                raise ValueError("同一时刻只能有一个 CG 事件")
                            cg_events_at[point_time] = (
                                cg_events_at.get(point_time, False) or explicit_point_time
                            )
                        elif isinstance(
                            block,
                            (GalgameStoryShowCharacterBlock, GalgameStoryRemoveCharacterBlock),
                        ):
                            character_id = (
                                block.character_id if block.character_id is not None else "__all__"
                            )
                            simultaneous = character_events_at.setdefault(point_time, [])
                            for existing_id, existing_explicit in simultaneous:
                                overlaps = (
                                    character_id == existing_id
                                    or character_id == "__all__"
                                    or existing_id == "__all__"
                                )
                                if overlaps and (explicit_point_time or existing_explicit):
                                    raise ValueError("同一角色在同一时刻只能有一个舞台事件")
                            simultaneous.append((character_id, explicit_point_time))
                        elif (
                            isinstance(block, GalgameStoryAudioBlock)
                            and block.action == "play"
                            and block.channel in {"bgm", "ambient"}
                        ):
                            event_key = (point_time, block.channel)
                            if event_key in audio_plays_at and (
                                explicit_point_time or audio_plays_at[event_key]
                            ):
                                raise ValueError("同一时刻同一持续声音通道只能播放一个素材")
                            audio_plays_at[event_key] = (
                                audio_plays_at.get(event_key, False) or explicit_point_time
                            )
                    if isinstance(
                        block,
                        (
                            GalgameStoryDialogueBlock,
                            GalgameStoryNarrationBlock,
                            GalgameStoryStoryParagraphBlock,
                            GalgameStorySystemMessageBlock,
                        ),
                    ):
                        if fragment.timeline is None:
                            if block.start_ms is not None or block.end_ms is not None:
                                raise ValueError("普通 Fragment 的对白不能包含时间轴范围")
                        else:
                            if block.start_ms is None or block.end_ms is None:
                                raise ValueError("时间轴 Fragment 的对白必须包含开始和结束时间")
                            if block.start_ms < previous_end_ms:
                                raise ValueError("时间轴对白不能重叠或逆序")
                            if block.end_ms > fragment.timeline.duration_ms:
                                raise ValueError("时间轴对白不能超过剧情时间轴总长")
                            previous_end_ms = block.end_ms
                    if isinstance(block, GalgameStoryDialogueBlock):
                        if any(
                            speaker_id not in known_characters
                            for speaker_id in block.effective_speaker_ids
                        ):
                            raise ValueError("对白引用了不存在的说话角色")
                        if (
                            block.expression_id is not None
                            and block.expression_id
                            not in expressions_by_character[block.character_id]
                        ):
                            raise ValueError("对白引用了不属于当前角色的表情")
                        if block.voice_asset_id is not None:
                            voice_asset = assets_by_id.get(block.voice_asset_id)
                            if voice_asset is None:
                                raise ValueError("对白引用了不存在的配音素材")
                            if voice_asset.role != "voiceLine":
                                raise ValueError("对白只能引用逐句配音素材")
                        if block.content is not None:
                            for node in block.content.nodes:
                                if isinstance(node, GalgameStoryRichTextVariableNode):
                                    if node.variable_id not in known_variables:
                                        raise ValueError("对白富文本引用了不存在的变量")
                                elif isinstance(node, GalgameStoryRichTextExpressionNode):
                                    if (
                                        node.expression_id
                                        not in expressions_by_character[block.character_id]
                                    ):
                                        raise ValueError("对白内联表情不属于当前角色")
                    elif isinstance(
                        block, (GalgameStoryNarrationBlock, GalgameStoryStoryParagraphBlock)
                    ):
                        if block.content is not None:
                            for node in block.content.nodes:
                                if isinstance(node, GalgameStoryRichTextExpressionNode):
                                    raise ValueError("只有对白可以包含内联表情")
                                if (
                                    isinstance(node, GalgameStoryRichTextVariableNode)
                                    and node.variable_id not in known_variables
                                ):
                                    raise ValueError("富文本引用了不存在的变量")
                    elif isinstance(block, GalgameStorySystemMessageBlock):
                        if block.result_variable_id is not None:
                            variable = variables_by_id.get(block.result_variable_id)
                            if variable is None:
                                raise ValueError("系统消息引用了不存在的结果变量")
                            if variable.type != "boolean":
                                raise ValueError("系统消息结果只能写入布尔变量")
                    elif isinstance(block, GalgameStoryShowCharacterBlock):
                        if block.character_id not in known_characters:
                            raise ValueError("角色登场 Block 引用了不存在的角色")
                        if (
                            block.expression_id is not None
                            and block.expression_id
                            not in expressions_by_character[block.character_id]
                        ):
                            raise ValueError("角色登场 Block 引用了不属于当前角色的表情")
                    elif isinstance(block, GalgameStoryRemoveCharacterBlock):
                        if (
                            block.character_id is not None
                            and block.character_id not in known_characters
                        ):
                            raise ValueError("角色退场 Block 引用了不存在的角色")
                    elif isinstance(block, GalgameStorySceneBlock):
                        if block.scene_id not in known_scenes:
                            raise ValueError("场景 Block 引用了不存在的场景")
                    elif isinstance(block, GalgameStoryShowCgBlock):
                        cg = cgs_by_id.get(block.cg_id)
                        if cg is None:
                            raise ValueError("显示 CG Block 引用了不存在的 CG")
                        variant_id = block.variant_id or cg.default_variant_id
                        if variant_id is None or variant_id not in variants_by_cg[block.cg_id]:
                            raise ValueError("显示 CG Block 必须引用有效的 CG 差分")
                    elif isinstance(block, GalgameStoryAudioBlock):
                        if block.action == "play":
                            audio_asset = assets_by_id.get(block.asset_id or "")
                            if audio_asset is None:
                                raise ValueError("声音 Block 引用了不存在的声音素材")
                            expected_role = {
                                "bgm": "backgroundMusic",
                                "ambient": "ambientSound",
                                "sfx": "soundEffect",
                            }[block.channel]
                            if audio_asset.role != expected_role:
                                raise ValueError("声音 Block 的素材与播放通道不匹配")
                    elif isinstance(block, GalgameStoryVideoBlock):
                        video_asset = assets_by_id.get(block.asset_id or "")
                        if block.action == "play" and (
                            video_asset is None or video_asset.type != "video"
                        ):
                            raise ValueError("视频 Block 必须引用视频素材")
                    elif isinstance(block, GalgameStoryAnimateSpriteBlock):
                        if block.character_id not in known_characters:
                            raise ValueError("精灵动画 Block 引用了不存在的角色")
                    elif isinstance(block, GalgameStoryGalleryBlock):
                        if block.asset_id not in assets_by_id:
                            raise ValueError("鉴赏 Block 引用了不存在的素材")
                    elif isinstance(block, GalgameStoryBranchBlock):
                        if any(
                            choice.target_fragment_id not in known_fragments
                            for choice in block.choices
                        ):
                            raise ValueError("分支选项引用了当前章节外的 Fragment")
                    elif isinstance(block, GalgameStoryIfBlock):
                        targets = {block.then_fragment_id}
                        if block.else_fragment_id is not None:
                            targets.add(block.else_fragment_id)
                        if not targets.issubset(known_fragments):
                            raise ValueError("条件 Block 引用了当前章节外的 Fragment")
                    elif isinstance(block, GalgameStoryCallFragmentBlock):
                        if block.target_fragment_id not in known_fragments:
                            raise ValueError("调用 Fragment Block 引用了当前章节外的 Fragment")
                    elif isinstance(block, GalgameStorySetVariableBlock):
                        if block.variable_id not in known_variables:
                            raise ValueError("变量赋值 Block 引用了未声明变量")
                        variable = variables_by_id[block.variable_id]
                        if variable.type == "boolean":
                            if block.operator not in {"set", "toggle"}:
                                raise ValueError("布尔变量只支持赋值或切换")
                            if block.operator == "set" and not isinstance(block.value, bool):
                                raise ValueError("变量赋值与声明类型不一致")
                        elif variable.type == "number":
                            if block.operator == "toggle" or not (
                                isinstance(block.value, (int, float))
                                and not isinstance(block.value, bool)
                            ):
                                raise ValueError("数值变量操作必须使用数值")
                        elif block.operator != "set" or not isinstance(block.value, str):
                            raise ValueError("字符串变量只支持字符串赋值")
                    elif isinstance(block, GalgameStoryEndChapterBlock):
                        if block.ending_id is not None:
                            ending_ids.append(block.ending_id)
        if len(block_ids) != len(set(block_ids)):
            raise ValueError("Block ID 必须在整个工程内唯一")
        if len(all_fragment_ids) != len(set(all_fragment_ids)):
            raise ValueError("Fragment ID 必须在整个工程内唯一")
        if len(ending_ids) != len(set(ending_ids)):
            raise ValueError("结局 ID 必须在整个工程内唯一")
        return self


class GalgameStoryDocumentPutIn(GalgameStoryModel):
    expected_revision: int = Field(ge=0)
    document: GalgameStoryProject


class GalgameStoryDocumentOut(BaseModel):
    project_id: str
    document: GalgameStoryProject
    revision: int
    updated_at: str

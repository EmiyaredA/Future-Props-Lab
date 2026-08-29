from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.schemas.galgame_workshop.blocks import (
    GalgameStoryAnimateSpriteBlock,
    GalgameStoryAudioBlock,
    GalgameStoryBranchBlock,
    GalgameStoryCallFragmentBlock,
    GalgameStoryCameraBlock,
    GalgameStoryCurtainBlock,
    GalgameStoryDestroySceneBlock,
    GalgameStoryDialogueBlock,
    GalgameStoryEndChapterBlock,
    GalgameStoryFloatingTextBlock,
    GalgameStoryGalleryBlock,
    GalgameStoryHideCgBlock,
    GalgameStoryIfBlock,
    GalgameStoryNarrationBlock,
    GalgameStoryParticleBlock,
    GalgameStoryRemoveCharacterBlock,
    GalgameStoryResetCameraBlock,
    GalgameStoryRichTextExpressionNode,
    GalgameStoryRichTextVariableNode,
    GalgameStorySceneBlock,
    GalgameStorySetStageCastBlock,
    GalgameStorySetVariableBlock,
    GalgameStoryShowCgBlock,
    GalgameStoryShowCharacterBlock,
    GalgameStoryStageAnimationBlock,
    GalgameStoryStoryParagraphBlock,
    GalgameStorySystemMessageBlock,
    GalgameStoryVideoBlock,
)

TEXT_BLOCKS = (
    GalgameStoryDialogueBlock,
    GalgameStoryNarrationBlock,
    GalgameStoryStoryParagraphBlock,
    GalgameStorySystemMessageBlock,
)
POINT_BLOCKS = (
    GalgameStorySceneBlock,
    GalgameStoryShowCgBlock,
    GalgameStoryHideCgBlock,
    GalgameStoryShowCharacterBlock,
    GalgameStorySetStageCastBlock,
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
)


@dataclass(frozen=True, slots=True)
class StoryIndex:
    known_characters: set[str]
    known_scene_groups: set[str]
    known_scenes: set[str]
    known_variables: set[str]
    known_attributes: set[str]
    variables_by_id: dict[str, Any]
    attribute_types: dict[str, str]
    assets_by_id: dict[str, Any]
    cgs_by_id: dict[str, Any]
    blocks_by_id: dict[str, Any]


def _unique(values: list[Any], message: str) -> None:
    if len(values) != len(set(values)):
        raise ValueError(message)


def validate_identity(project: Any) -> StoryIndex:
    character_ids = [item.id for item in project.characters]
    scene_group_ids = [item.id for item in project.scene_groups]
    scene_ids = [item.id for item in project.scenes]
    cg_ids = [item.id for item in project.cgs]
    chapter_ids = [item.id for item in project.chapters]
    asset_ids = [item.id for item in project.assets]
    variable_ids = [item.id for item in project.variables]
    attribute_ids = [item.id for item in project.character_attribute_templates]
    _unique(character_ids, "角色 ID 不能重复")
    _unique(scene_group_ids, "场景分组 ID 不能重复")
    _unique(scene_ids, "场景 ID 不能重复")
    _unique(cg_ids, "CG ID 不能重复")
    _unique(chapter_ids, "章节 ID 不能重复")
    _unique([item.order for item in project.chapters], "章节顺序不能重复")
    _unique(asset_ids, "素材 ID 不能重复")
    _unique(variable_ids, "变量 ID 不能重复")
    _unique(attribute_ids, "角色属性模板 ID 不能重复")
    if project.entry_chapter_id not in set(chapter_ids):
        raise ValueError("入口章节不存在")
    entry = next(item for item in project.chapters if item.id == project.entry_chapter_id)
    if entry.disabled:
        raise ValueError("入口章节不能禁用")
    known_characters = set(character_ids)
    if not set(project.settings.character_stage_overrides).issubset(known_characters):
        raise ValueError("角色舞台独立方案引用了不存在的角色")
    return StoryIndex(
        known_characters=known_characters,
        known_scene_groups=set(scene_group_ids),
        known_scenes=set(scene_ids),
        known_variables=set(variable_ids),
        known_attributes=set(attribute_ids),
        variables_by_id={item.id: item for item in project.variables},
        attribute_types={item.id: item.type for item in project.character_attribute_templates},
        assets_by_id={item.id: item for item in project.assets},
        cgs_by_id={item.id: item for item in project.cgs},
        blocks_by_id={
            block.id: block
            for chapter in project.chapters
            for fragment in chapter.fragments
            for block in fragment.blocks
        },
    )


def validate_localizations(project: Any, index: StoryIndex) -> None:
    if project.localizations is None:
        return
    for target in project.localizations.targets:
        for entry in target.entries:
            block = index.blocks_by_id.get(entry.block_id)
            if block is None:
                raise ValueError("译文引用的 Block 不存在")
            if isinstance(
                block,
                (
                    GalgameStoryNarrationBlock,
                    GalgameStoryStoryParagraphBlock,
                    GalgameStoryDialogueBlock,
                    GalgameStoryFloatingTextBlock,
                ),
            ):
                fields = {"text"}
            elif isinstance(block, GalgameStorySystemMessageBlock):
                fields = {"text", "title", "acceptLabel", "cancelLabel"}
            elif isinstance(block, GalgameStoryBranchBlock):
                fields = {"prompt", "choiceText"}
            elif isinstance(block, GalgameStoryEndChapterBlock):
                fields = {"label"}
            else:
                fields = set()
            if entry.field not in fields:
                raise ValueError("译文字段与 Block 类型不匹配")
            if entry.field == "choiceText" and not any(
                choice.id == entry.choice_id for choice in block.choices
            ):
                raise ValueError("译文引用的 Choice 不存在")


def validate_characters(project: Any, index: StoryIndex) -> dict[str, set[str]]:
    expressions: dict[str, set[str]] = {}
    for character in project.characters:
        if not set(character.attributes).issubset(index.known_attributes):
            raise ValueError("角色包含未声明的属性")
        for attribute_id, value in character.attributes.items():
            expected = index.attribute_types[attribute_id]
            valid = {
                "string": isinstance(value, str),
                "number": isinstance(value, (int, float)) and not isinstance(value, bool),
                "boolean": isinstance(value, bool),
            }[expected]
            if not valid:
                raise ValueError("角色属性值与模板类型不一致")
        expressions[character.id] = {item.id for item in character.expressions}
        for name in character.display_names:
            if name.source == "variable":
                variable = index.variables_by_id.get(name.variable_id or "")
                if variable is None:
                    raise ValueError("角色显示名引用了不存在的变量")
                if variable.type != "string":
                    raise ValueError("角色显示名只能引用字符串变量")
            elif name.source == "attribute":
                if name.attribute_id not in index.known_attributes:
                    raise ValueError("角色显示名引用了不存在的角色属性")
                if index.attribute_types[name.attribute_id or ""] != "string":
                    raise ValueError("角色显示名只能引用字符串角色属性")
        _validate_character_assets(character, index, expressions[character.id])
    return expressions


def _require_asset(index: StoryIndex, asset_id: str, missing: str, role: str, mismatch: str):
    asset = index.assets_by_id.get(asset_id)
    if asset is None:
        raise ValueError(missing)
    if asset.role != role:
        raise ValueError(mismatch)
    return asset


def _validate_character_assets(character: Any, index: StoryIndex, expression_ids: set[str]) -> None:
    for expression in character.expressions:
        _require_asset(
            index,
            expression.asset_id,
            "角色表情引用了不存在的立绘素材",
            "characterPortrait",
            "角色表情只能引用角色立绘素材",
        )
        if expression.sequence is not None:
            for frame in expression.sequence.frames:
                _require_asset(
                    index,
                    frame.asset_id,
                    "角色表情序列帧引用了不存在的立绘素材",
                    "characterPortrait",
                    "角色表情序列帧只能引用角色立绘素材",
                )
        if expression.dialogue_avatar.asset_id is not None:
            _require_asset(
                index,
                expression.dialogue_avatar.asset_id,
                "表情对白头像引用了不存在的图片素材",
                "dialogueAvatar",
                "独立对白头像只能引用对白头像素材",
            )
        for overlay in expression.overlays:
            _require_asset(
                index,
                overlay.asset_id,
                "表情图形覆盖引用了不存在的图片素材",
                "characterOverlay",
                "表情图形覆盖只能引用角色覆盖素材",
            )
    for skin in character.portrait_skins:
        for override in skin.overrides:
            if override.expression_id not in expression_ids:
                raise ValueError("立绘皮肤覆盖了不存在的角色表情")
            _require_asset(
                index,
                override.asset_id,
                "立绘皮肤引用了不存在的立绘素材",
                "characterPortrait",
                "立绘皮肤只能引用角色立绘素材",
            )
    voice = character.voice_profile
    if voice is not None and voice.sample_asset_id is not None:
        _require_asset(
            index,
            voice.sample_asset_id,
            "角色声线引用了不存在的试听样本",
            "voiceSample",
            "角色声线只能引用试听样本素材",
        )


def validate_assets_and_presentation(project: Any, index: StoryIndex) -> dict[str, set[str]]:
    for scene in project.scenes:
        if scene.group_id is not None and scene.group_id not in index.known_scene_groups:
            raise ValueError("场景引用了不存在的分组")
        for layer in scene.layers:
            _require_asset(
                index,
                layer.asset_id,
                "场景图层引用了不存在的图片素材",
                "sceneLayer",
                "场景图层只能引用场景图层素材",
            )
    variants: dict[str, set[str]] = {}
    for cg in project.cgs:
        variants[cg.id] = {item.id for item in cg.variants}
        for variant in cg.variants:
            _require_asset(
                index,
                variant.asset_id,
                "CG 差分引用了不存在的图片素材",
                "storyCg",
                "CG 差分只能引用剧情 CG 素材",
            )
    dialogue_asset_id = project.presentation.dialogue_box.asset_id
    if dialogue_asset_id is not None:
        _require_asset(
            index,
            dialogue_asset_id,
            "对话框样式引用了不存在的图片素材",
            "dialogueBox",
            "对话框样式只能引用对话框底图素材",
        )
    for component in project.presentation.ui.components:
        if component.asset_id is None:
            continue
        _require_asset(
            index,
            component.asset_id,
            f"界面组件“{component.name}”引用了不存在的图片素材",
            "uiComponent",
            f"界面组件“{component.name}”只能引用界面组件素材",
        )
    for style in project.presentation.system_message.custom_styles:
        if style.asset_id is None:
            continue
        _require_asset(
            index,
            style.asset_id,
            f"消息框样式“{style.name}”引用了不存在的图片素材",
            "uiComponent",
            f"消息框样式“{style.name}”只能引用界面组件素材",
        )
    return variants


def validate_timeline(fragment: Any, index: StoryIndex) -> None:
    timeline = fragment.timeline
    if timeline is not None and timeline.master_audio is not None:
        asset = index.assets_by_id.get(timeline.master_audio.asset_id)
        if asset is None:
            raise ValueError("时间轴主音轨引用了不存在的音频素材")
        if asset.type != "audio" or asset.role != "timelineMaster":
            raise ValueError("时间轴主音轨只能引用 timelineMaster 音频素材")
    previous_end_ms = 0
    scene_events: dict[int, bool] = {}
    cg_events: dict[int, bool] = {}
    character_events: dict[int, list[tuple[str, bool]]] = {}
    audio_events: dict[tuple[int, str], bool] = {}
    timed_cues = [
        (position, block.start_ms)
        for position, block in enumerate(fragment.blocks)
        if isinstance(block, TEXT_BLOCKS) and block.start_ms is not None
    ]
    for position, block in enumerate(fragment.blocks):
        point_time = block.at_ms if isinstance(block, POINT_BLOCKS) else None
        if timeline is None:
            if point_time is not None:
                raise ValueError("普通 Fragment 的演出事件不能包含时间轴锚点")
        elif isinstance(block, POINT_BLOCKS):
            point_time = _resolved_point_time(block, position, timed_cues, timeline.duration_ms)
            if point_time > timeline.duration_ms:
                raise ValueError("演出事件不能超过剧情时间轴总长")
            _validate_simultaneous_event(
                block,
                point_time,
                scene_events,
                cg_events,
                character_events,
                audio_events,
            )
        if isinstance(block, TEXT_BLOCKS):
            if timeline is None:
                if block.start_ms is not None or block.end_ms is not None:
                    raise ValueError("普通 Fragment 的对白不能包含时间轴范围")
            else:
                if block.start_ms is None or block.end_ms is None:
                    raise ValueError("时间轴 Fragment 的对白必须包含开始和结束时间")
                if block.start_ms < previous_end_ms:
                    raise ValueError("时间轴对白不能重叠或逆序")
                if block.end_ms > timeline.duration_ms:
                    raise ValueError("时间轴对白不能超过剧情时间轴总长")
                previous_end_ms = block.end_ms


def _resolved_point_time(block: Any, position: int, cues: list[tuple[int, int]], duration: int):
    if block.at_ms is not None:
        return block.at_ms
    next_cue = next((item for item in cues if item[0] > position), None)
    if isinstance(
        block,
        (
            GalgameStoryShowCharacterBlock,
            GalgameStorySetStageCastBlock,
            GalgameStoryRemoveCharacterBlock,
        ),
    ):
        return next_cue[1] if next_cue is not None else duration
    return (
        0
        if next_cue is not None and cues and cues[0][0] > position
        else (next_cue[1] if next_cue is not None else duration)
    )


def _validate_simultaneous_event(
    block: Any,
    point_time: int,
    scenes: dict[int, bool],
    cgs: dict[int, bool],
    characters: dict[int, list[tuple[str, bool]]],
    audio: dict[tuple[int, str], bool],
) -> None:
    explicit = block.at_ms is not None
    if isinstance(block, GalgameStorySceneBlock):
        if point_time in scenes and (explicit or scenes[point_time]):
            raise ValueError("同一时刻只能切换一次场景")
        scenes[point_time] = scenes.get(point_time, False) or explicit
    elif isinstance(block, (GalgameStoryShowCgBlock, GalgameStoryHideCgBlock)):
        if point_time in cgs and (explicit or cgs[point_time]):
            raise ValueError("同一时刻只能有一个 CG 事件")
        cgs[point_time] = cgs.get(point_time, False) or explicit
    elif isinstance(
        block,
        (
            GalgameStoryShowCharacterBlock,
            GalgameStorySetStageCastBlock,
            GalgameStoryRemoveCharacterBlock,
        ),
    ):
        character_id = (
            "__all__"
            if isinstance(block, GalgameStorySetStageCastBlock) or block.character_id is None
            else block.character_id
        )
        simultaneous = characters.setdefault(point_time, [])
        for existing_id, existing_explicit in simultaneous:
            overlaps = character_id == existing_id or "__all__" in {character_id, existing_id}
            if overlaps and (explicit or existing_explicit):
                raise ValueError("同一角色在同一时刻只能有一个舞台事件")
        simultaneous.append((character_id, explicit))
    elif (
        isinstance(block, GalgameStoryAudioBlock)
        and block.action == "play"
        and block.channel
        in {
            "bgm",
            "ambient",
        }
    ):
        key = (point_time, block.channel)
        if key in audio and (explicit or audio[key]):
            raise ValueError("同一时刻同一持续声音通道只能播放一个素材")
        audio[key] = audio.get(key, False) or explicit


def validate_flow_and_blocks(
    project: Any,
    index: StoryIndex,
    expressions: dict[str, set[str]],
    variants: dict[str, set[str]],
) -> None:
    block_ids: list[str] = []
    fragment_ids_all: list[str] = []
    ending_ids: list[str] = []
    for chapter in project.chapters:
        fragment_ids = [item.id for item in chapter.fragments]
        fragment_ids_all.extend(fragment_ids)
        _unique(fragment_ids, f"章节“{chapter.title}”的 Fragment ID 不能重复")
        known_fragments = set(fragment_ids)
        if chapter.entry_fragment_id not in known_fragments:
            raise ValueError(f"章节“{chapter.title}”的入口 Fragment 不存在")
        for fragment in chapter.fragments:
            validate_timeline(fragment, index)
            for block in fragment.blocks:
                block_ids.append(block.id)
                _validate_block(block, index, expressions, variants, known_fragments, ending_ids)
    _unique(block_ids, "Block ID 必须在整个工程内唯一")
    _unique(fragment_ids_all, "Fragment ID 必须在整个工程内唯一")
    _unique(ending_ids, "结局 ID 必须在整个工程内唯一")


def _validate_block(
    block: Any,
    index: StoryIndex,
    expressions: dict[str, set[str]],
    variants: dict[str, set[str]],
    known_fragments: set[str],
    ending_ids: list[str],
) -> None:
    if isinstance(block, GalgameStoryDialogueBlock):
        if any(item not in index.known_characters for item in block.effective_speaker_ids):
            raise ValueError("对白引用了不存在的说话角色")
        if (
            block.expression_id is not None
            and block.expression_id not in expressions[block.character_id]
        ):
            raise ValueError("对白引用了不属于当前角色的表情")
        if block.voice_asset_id is not None:
            _require_asset(
                index,
                block.voice_asset_id,
                "对白引用了不存在的配音素材",
                "voiceLine",
                "对白只能引用逐句配音素材",
            )
        _validate_rich_text(block, index, expressions)
    elif isinstance(block, (GalgameStoryNarrationBlock, GalgameStoryStoryParagraphBlock)):
        if block.content is not None:
            for node in block.content.nodes:
                if isinstance(node, GalgameStoryRichTextExpressionNode):
                    raise ValueError("只有对白可以包含内联表情")
                if (
                    isinstance(node, GalgameStoryRichTextVariableNode)
                    and node.variable_id not in index.known_variables
                ):
                    raise ValueError("富文本引用了不存在的变量")
    elif isinstance(block, GalgameStorySystemMessageBlock):
        if block.result_variable_id is not None:
            variable = index.variables_by_id.get(block.result_variable_id)
            if variable is None:
                raise ValueError("系统消息引用了不存在的结果变量")
            if variable.type != "boolean":
                raise ValueError("系统消息结果只能写入布尔变量")
    elif isinstance(block, GalgameStoryShowCharacterBlock):
        _validate_character_reference(
            block.character_id, block.expression_id, index, expressions, "角色登场"
        )
    elif isinstance(block, GalgameStorySetStageCastBlock):
        for member in block.members:
            _validate_character_reference(
                member.character_id, member.expression_id, index, expressions, "舞台构图"
            )
    elif isinstance(block, GalgameStoryRemoveCharacterBlock):
        if block.character_id is not None and block.character_id not in index.known_characters:
            raise ValueError("角色退场 Block 引用了不存在的角色")
    elif isinstance(block, GalgameStorySceneBlock):
        if block.scene_id not in index.known_scenes:
            raise ValueError("场景 Block 引用了不存在的场景")
    elif isinstance(block, GalgameStoryShowCgBlock):
        cg = index.cgs_by_id.get(block.cg_id)
        if cg is None:
            raise ValueError("显示 CG Block 引用了不存在的 CG")
        variant_id = block.variant_id or cg.default_variant_id
        if variant_id is None or variant_id not in variants[block.cg_id]:
            raise ValueError("显示 CG Block 必须引用有效的 CG 差分")
    elif isinstance(block, GalgameStoryAudioBlock) and block.action == "play":
        asset = index.assets_by_id.get(block.asset_id or "")
        if asset is None:
            raise ValueError("声音 Block 引用了不存在的声音素材")
        expected = {"bgm": "backgroundMusic", "ambient": "ambientSound", "sfx": "soundEffect"}[
            block.channel
        ]
        if asset.role != expected:
            raise ValueError("声音 Block 的素材与播放通道不匹配")
    elif isinstance(block, GalgameStoryVideoBlock):
        asset = index.assets_by_id.get(block.asset_id or "")
        if block.action == "play" and (asset is None or asset.type != "video"):
            raise ValueError("视频 Block 必须引用视频素材")
    elif isinstance(block, GalgameStoryAnimateSpriteBlock):
        if block.character_id not in index.known_characters:
            raise ValueError("精灵动画 Block 引用了不存在的角色")
    elif isinstance(block, GalgameStoryGalleryBlock):
        if block.asset_id not in index.assets_by_id:
            raise ValueError("鉴赏 Block 引用了不存在的素材")
    elif isinstance(block, GalgameStoryBranchBlock):
        if any(item.target_fragment_id not in known_fragments for item in block.choices):
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
        _validate_variable_write(block, index)
    elif isinstance(block, GalgameStoryEndChapterBlock) and block.ending_id is not None:
        ending_ids.append(block.ending_id)


def _validate_rich_text(block: Any, index: StoryIndex, expressions: dict[str, set[str]]) -> None:
    if block.content is None:
        return
    for node in block.content.nodes:
        if isinstance(node, GalgameStoryRichTextVariableNode):
            if node.variable_id not in index.known_variables:
                raise ValueError("对白富文本引用了不存在的变量")
        elif isinstance(node, GalgameStoryRichTextExpressionNode):
            if node.expression_id not in expressions[block.character_id]:
                raise ValueError("对白内联表情不属于当前角色")


def _validate_character_reference(
    character_id: str,
    expression_id: str | None,
    index: StoryIndex,
    expressions: dict[str, set[str]],
    label: str,
) -> None:
    if character_id not in index.known_characters:
        raise ValueError(f"{label} Block 引用了不存在的角色")
    if expression_id is not None and expression_id not in expressions[character_id]:
        raise ValueError(f"{label} Block 引用了不属于当前角色的表情")


def _validate_variable_write(block: Any, index: StoryIndex) -> None:
    if block.variable_id not in index.known_variables:
        raise ValueError("变量赋值 Block 引用了未声明变量")
    variable = index.variables_by_id[block.variable_id]
    if variable.type == "boolean":
        if block.operator not in {"set", "toggle"}:
            raise ValueError("布尔变量只支持赋值或切换")
        if block.operator == "set" and not isinstance(block.value, bool):
            raise ValueError("变量赋值与声明类型不一致")
    elif variable.type == "number":
        if block.operator == "toggle" or not (
            isinstance(block.value, (int, float)) and not isinstance(block.value, bool)
        ):
            raise ValueError("数值变量操作必须使用数值")
    elif block.operator != "set" or not isinstance(block.value, str):
        raise ValueError("字符串变量只支持字符串赋值")


def validate_story_project(project: Any) -> None:
    index = validate_identity(project)
    validate_localizations(project, index)
    expressions = validate_characters(project, index)
    variants = validate_assets_and_presentation(project, index)
    validate_flow_and_blocks(project, index, expressions, variants)

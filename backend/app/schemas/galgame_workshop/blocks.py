from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.galgame_workshop.base import GalgameStorySourceRef
from app.schemas.galgame_workshop.base_core import (
    HEX_COLOR_PATTERN,
    STABLE_ID_PATTERN,
    GalgameStoryModel,
    _clean_title,
)


def _optional_timeline_ms() -> Any:
    return Field(default=None, alias="atMs", ge=0, exclude_if=lambda value: value is None)


class GalgameStoryBlockBase(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)


class GalgameStorySceneBlock(GalgameStoryBlockBase):
    type: Literal["scene"]
    at_ms: int | None = _optional_timeline_ms()
    scene_id: str = Field(alias="sceneId", pattern=STABLE_ID_PATTERN)
    clear_characters: bool | None = Field(default=None, alias="clearCharacters")

    @field_validator("clear_characters", mode="before")
    @classmethod
    def missing_clear_characters_uses_default(cls, value: Any) -> Any:
        return True if value is None else value


class GalgameStoryCgTransition(GalgameStoryModel):
    duration_ms: int = Field(default=400, alias="durationMs", ge=0, le=5000)
    fade: bool = True


class GalgameStoryCgOverlay(GalgameStoryModel):
    x: float = Field(default=50, ge=0, le=100)
    y: float = Field(default=50, ge=0, le=100)
    width: float = Field(default=60, ge=5, le=200)
    opacity: float = Field(default=1, ge=0, le=1)
    placement: Literal["behindCharacters", "frontOfCharacters"] = "frontOfCharacters"


class GalgameStoryShowCgBlock(GalgameStoryBlockBase):
    type: Literal["showCg"]
    at_ms: int | None = _optional_timeline_ms()
    cg_id: str = Field(alias="cgId", pattern=STABLE_ID_PATTERN)
    variant_id: str | None = Field(default=None, alias="variantId", pattern=STABLE_ID_PATTERN)
    display_mode: Literal["fullscreen", "overlay"] = Field(
        default="fullscreen", alias="displayMode"
    )
    fit: Literal["cover", "contain"] = "cover"
    overlay: GalgameStoryCgOverlay = Field(default_factory=GalgameStoryCgOverlay)
    transition: GalgameStoryCgTransition = Field(default_factory=GalgameStoryCgTransition)


class GalgameStoryHideCgBlock(GalgameStoryBlockBase):
    type: Literal["hideCg"]
    at_ms: int | None = _optional_timeline_ms()
    transition: GalgameStoryCgTransition = Field(default_factory=GalgameStoryCgTransition)


class GalgameStoryCharacterTransform(GalgameStoryModel):
    x: float = Field(default=50, ge=-1000, le=1000)
    y: float = Field(default=100, ge=-1000, le=1000)
    anchor: Literal["center", "topLeft", "bottomCenter"] = "bottomCenter"
    scale: float = Field(default=1, ge=0.25, le=3)
    brightness: float = Field(default=1, ge=0, le=2)
    opacity: float = Field(default=1, ge=0, le=1)
    flip_x: bool = Field(default=False, alias="flipX")
    layer: int = Field(default=10, ge=0, le=20)


class GalgameStoryCharacterTransition(GalgameStoryModel):
    duration_ms: int = Field(default=240, alias="durationMs", ge=0, le=5000)
    fade: bool = True


class GalgameStoryDialoguePortrait(GalgameStoryModel):
    mode: Literal["stage", "dialogueAvatar", "soloLegacy"] = "stage"
    visible: bool = True
    distance: Literal["far", "medium", "near"] = "medium"
    position_id: str | None = Field(
        default=None,
        alias="positionId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    skin_id: str | None = Field(
        default=None,
        alias="skinId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    keep_after: bool = Field(default=True, alias="keepAfter")
    transform: GalgameStoryCharacterTransform | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    transition: GalgameStoryCharacterTransition = Field(
        default_factory=GalgameStoryCharacterTransition
    )

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_modes(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        migrated = dict(value)
        mode = migrated.get("mode")
        if mode == "hidden":
            migrated["mode"] = "stage"
            migrated.setdefault("visible", False)
        elif mode == "solo":
            migrated["mode"] = "soloLegacy"
        return migrated


class GalgameStoryShowCharacterBlock(GalgameStoryBlockBase):
    type: Literal["showCharacter"]
    at_ms: int | None = _optional_timeline_ms()
    character_id: str = Field(alias="characterId", pattern=STABLE_ID_PATTERN)
    expression_id: str | None = Field(default=None, alias="expressionId", pattern=STABLE_ID_PATTERN)
    distance: Literal["far", "medium", "near"] = "medium"
    position_id: str | None = Field(
        default=None,
        alias="positionId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    transform: GalgameStoryCharacterTransform = Field(
        default_factory=GalgameStoryCharacterTransform
    )
    transition: GalgameStoryCharacterTransition = Field(
        default_factory=GalgameStoryCharacterTransition
    )


class GalgameStoryStageCastMember(GalgameStoryModel):
    character_id: str = Field(alias="characterId", pattern=STABLE_ID_PATTERN)
    expression_id: str | None = Field(default=None, alias="expressionId", pattern=STABLE_ID_PATTERN)
    skin_id: str | None = Field(
        default=None,
        alias="skinId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    distance: Literal["far", "medium", "near"] = "medium"
    position_id: str | None = Field(
        default=None,
        alias="positionId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    transform: GalgameStoryCharacterTransform = Field(
        default_factory=GalgameStoryCharacterTransform
    )
    transition: GalgameStoryCharacterTransition = Field(
        default_factory=GalgameStoryCharacterTransition
    )


class GalgameStorySetStageCastBlock(GalgameStoryBlockBase):
    type: Literal["setStageCast"]
    at_ms: int | None = _optional_timeline_ms()
    members: list[GalgameStoryStageCastMember] = Field(default_factory=list, max_length=3)
    exit_transition: GalgameStoryCharacterTransition = Field(
        default_factory=GalgameStoryCharacterTransition, alias="exitTransition"
    )

    @field_validator("members")
    @classmethod
    def members_are_unique(
        cls, members: list[GalgameStoryStageCastMember]
    ) -> list[GalgameStoryStageCastMember]:
        character_ids = [member.character_id for member in members]
        if len(character_ids) != len(set(character_ids)):
            raise ValueError("同一舞台构图不能重复放置角色")
        return members


class GalgameStoryRemoveCharacterBlock(GalgameStoryBlockBase):
    type: Literal["removeCharacter"]
    at_ms: int | None = _optional_timeline_ms()
    character_id: str | None = Field(
        default=None,
        alias="characterId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    all: bool = False
    transition: GalgameStoryCharacterTransition = Field(
        default_factory=GalgameStoryCharacterTransition
    )

    @model_validator(mode="after")
    def target_is_unambiguous(self) -> GalgameStoryRemoveCharacterBlock:
        if self.all == (self.character_id is not None):
            raise ValueError("角色退场必须指定一个角色或 all: true")
        return self


class GalgameStoryTimedBlockBase(GalgameStoryBlockBase):
    start_ms: int | None = Field(
        default=None, alias="startMs", ge=0, exclude_if=lambda value: value is None
    )
    end_ms: int | None = Field(
        default=None, alias="endMs", ge=0, exclude_if=lambda value: value is None
    )

    @model_validator(mode="after")
    def time_range_is_valid(self) -> GalgameStoryTimedBlockBase:
        if (self.start_ms is None) != (self.end_ms is None):
            raise ValueError("时间轴对白的开始和结束时间必须成对提供")
        if self.start_ms is not None and self.end_ms is not None and self.end_ms <= self.start_ms:
            raise ValueError("时间轴对白的结束时间必须晚于开始时间")
        return self


class GalgameStoryTextMarks(GalgameStoryModel):
    bold: bool = False
    italic: bool = False
    strike: bool = False
    color: str | None = Field(
        default=None, pattern=HEX_COLOR_PATTERN, exclude_if=lambda value: value is None
    )
    background_color: str | None = Field(
        default=None,
        alias="backgroundColor",
        pattern=HEX_COLOR_PATTERN,
        exclude_if=lambda value: value is None,
    )
    font_size_px: int | None = Field(
        default=None, alias="fontSizePx", ge=8, le=200, exclude_if=lambda value: value is None
    )


class GalgameStoryRichTextTextNode(GalgameStoryModel):
    type: Literal["text"]
    text: str = Field(max_length=20_000)
    marks: GalgameStoryTextMarks | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class GalgameStoryRichTextRubyNode(GalgameStoryModel):
    type: Literal["ruby"]
    text: str = Field(min_length=1, max_length=2000)
    reading: str = Field(min_length=1, max_length=2000)
    marks: GalgameStoryTextMarks | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class GalgameStoryRichTextVariableNode(GalgameStoryModel):
    type: Literal["variable"]
    variable_id: str = Field(alias="variableId", pattern=STABLE_ID_PATTERN)


class GalgameStoryRichTextLineBreakNode(GalgameStoryModel):
    type: Literal["lineBreak"]


class GalgameStoryRichTextWaitNode(GalgameStoryModel):
    type: Literal["wait"]
    mode: Literal["duration", "player"] = "duration"
    duration_ms: int | None = Field(
        default=500,
        alias="durationMs",
        ge=0,
        le=3_600_000,
        exclude_if=lambda value: value is None,
    )

    @model_validator(mode="after")
    def duration_matches_mode(self) -> GalgameStoryRichTextWaitNode:
        if self.mode == "duration" and self.duration_ms is None:
            raise ValueError("定时文字等待必须提供时长")
        if self.mode == "player":
            self.duration_ms = None
        return self


class GalgameStoryRichTextExpressionNode(GalgameStoryModel):
    type: Literal["expression"]
    expression_id: str = Field(alias="expressionId", pattern=STABLE_ID_PATTERN)


GalgameStoryRichTextNode = Annotated[
    GalgameStoryRichTextTextNode
    | GalgameStoryRichTextRubyNode
    | GalgameStoryRichTextVariableNode
    | GalgameStoryRichTextLineBreakNode
    | GalgameStoryRichTextWaitNode
    | GalgameStoryRichTextExpressionNode,
    Field(discriminator="type"),
]


class GalgameStoryRichTextDocument(GalgameStoryModel):
    version: Literal[1] = 1
    nodes: list[GalgameStoryRichTextNode] = Field(default_factory=list, max_length=2000)

    def plain_text(self) -> str:
        return "".join(
            node.text
            if isinstance(node, (GalgameStoryRichTextTextNode, GalgameStoryRichTextRubyNode))
            else "\n"
            if isinstance(node, GalgameStoryRichTextLineBreakNode)
            else ""
            for node in self.nodes
        )


class GalgameStoryRichTextTimedBlockBase(GalgameStoryTimedBlockBase):
    text: str = Field(default="", max_length=20_000)
    content: GalgameStoryRichTextDocument | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @model_validator(mode="after")
    def content_updates_plain_text(self) -> GalgameStoryRichTextTimedBlockBase:
        if self.content is not None:
            self.text = self.content.plain_text()
        return self


class GalgameStoryNarrationBlock(GalgameStoryRichTextTimedBlockBase):
    type: Literal["narration"]
    hide_dialogue_after: bool = Field(default=False, alias="hideDialogueAfter")


class GalgameStoryStoryParagraphBlock(GalgameStoryRichTextTimedBlockBase):
    type: Literal["storyParagraph"]
    text_speed_cps: int = Field(default=0, alias="textSpeedCps", ge=0, le=240)


class GalgameStoryParagraphParamsBlock(GalgameStoryBlockBase):
    type: Literal["paragraphParams"]
    text_speed_cps: int | None = Field(
        default=None, alias="textSpeedCps", ge=0, le=240, exclude_if=lambda value: value is None
    )
    fade_ms: int | None = Field(
        default=None, alias="fadeMs", ge=0, le=5000, exclude_if=lambda value: value is None
    )
    reveal_effect: Literal["typewriter", "fade", "instant"] | None = Field(
        default=None, alias="revealEffect", exclude_if=lambda value: value is None
    )
    read_behavior: Literal["inherit", "dim", "keep"] | None = Field(
        default=None, alias="readBehavior", exclude_if=lambda value: value is None
    )
    history_limit: int | None = Field(
        default=None, alias="historyLimit", ge=0, le=100, exclude_if=lambda value: value is None
    )
    style_ref: GalgameStorySourceRef | None = Field(
        default=None, alias="styleRef", exclude_if=lambda value: value is None
    )

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_params(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        migrated = dict(value)
        legacy_speed = migrated.pop("textSpeedMs", None)
        migrated.pop("autoAdvanceMs", None)
        migrated.pop("skippable", None)
        if "textSpeedCps" not in migrated and legacy_speed is not None:
            if legacy_speed == 0:
                migrated["revealEffect"] = "instant"
            else:
                migrated["textSpeedCps"] = max(1, min(240, round(1000 / legacy_speed)))
        return migrated

    @model_validator(mode="after")
    def has_change(self) -> GalgameStoryParagraphParamsBlock:
        if all(
            value is None
            for value in (
                self.text_speed_cps,
                self.fade_ms,
                self.reveal_effect,
                self.read_behavior,
                self.history_limit,
                self.style_ref,
            )
        ):
            raise ValueError("段落参数至少需要修改一项")
        return self


class GalgameStorySystemMessageBlock(GalgameStoryTimedBlockBase):
    type: Literal["systemMessage"]
    text: str = Field(default="", max_length=20_000)
    mode: Literal["alert", "confirm"] = "alert"
    title: str | None = Field(default=None, max_length=120)
    tone: Literal["info", "success", "warning", "danger"] = "info"
    accept_label: str | None = Field(default=None, alias="acceptLabel", max_length=80)
    cancel_label: str | None = Field(default=None, alias="cancelLabel", max_length=80)
    result_variable_id: str | None = Field(
        default=None,
        alias="resultVariableId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )

    @model_validator(mode="after")
    def result_requires_confirm(self) -> GalgameStorySystemMessageBlock:
        if self.mode == "alert" and self.result_variable_id is not None:
            raise ValueError("提示消息不能保存确认结果")
        return self


class GalgameStoryCommentBlock(GalgameStoryBlockBase):
    type: Literal["comment"]
    text: str = Field(default="", max_length=20_000)


class GalgameStoryWaitBlock(GalgameStoryBlockBase):
    type: Literal["wait"]
    mode: Literal["duration", "player"] = "duration"
    duration_ms: int | None = Field(
        default=1000,
        alias="durationMs",
        ge=0,
        le=3_600_000,
        exclude_if=lambda value: value is None,
    )

    @model_validator(mode="after")
    def duration_matches_mode(self) -> GalgameStoryWaitBlock:
        if self.mode == "duration" and self.duration_ms is None:
            raise ValueError("定时等待必须提供时长")
        if self.mode == "player":
            self.duration_ms = None
        return self


class GalgameStoryDialogueBlock(GalgameStoryRichTextTimedBlockBase):
    type: Literal["dialogue"]
    character_id: str = Field(alias="characterId", pattern=STABLE_ID_PATTERN)
    speaker_ids: list[str] | None = Field(
        default=None,
        alias="speakerIds",
        min_length=1,
        max_length=16,
        exclude_if=lambda value: value is None,
    )
    expression_id: str | None = Field(default=None, alias="expressionId", pattern=STABLE_ID_PATTERN)
    display_name_id: str | None = Field(
        default=None,
        alias="displayNameId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    hide_dialogue_after: bool = Field(default=False, alias="hideDialogueAfter")
    voice_asset_id: str | None = Field(
        default=None, alias="voiceAssetId", pattern=STABLE_ID_PATTERN
    )
    voice_volume: int | None = Field(default=None, alias="voiceVolume", ge=0, le=100)
    portrait: GalgameStoryDialoguePortrait | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @model_validator(mode="before")
    @classmethod
    def default_voice_volume(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        normalized.setdefault("voiceVolume", 100)
        return normalized

    @field_validator("voice_volume", mode="before")
    @classmethod
    def null_voice_volume_uses_default(cls, value: Any) -> Any:
        return 100 if value is None else value

    @model_validator(mode="after")
    def speakers_are_unambiguous(self) -> GalgameStoryDialogueBlock:
        if self.speaker_ids is None:
            return self
        if len(self.speaker_ids) != len(set(self.speaker_ids)):
            raise ValueError("对白的同时说话角色不能重复")
        if self.speaker_ids[0] != self.character_id:
            raise ValueError("对白的主说话角色必须是 speakerIds 的第一项")
        return self

    @property
    def effective_speaker_ids(self) -> list[str]:
        return self.speaker_ids or [self.character_id]


class GalgameStoryAudioBlock(GalgameStoryBlockBase):
    type: Literal["audio"]
    at_ms: int | None = Field(
        default=None, alias="atMs", ge=0, exclude_if=lambda value: value is None
    )
    action: Literal["play", "stop"]
    channel: Literal["bgm", "ambient", "sfx"]
    asset_id: str | None = Field(default=None, alias="assetId", pattern=STABLE_ID_PATTERN)
    volume: int = Field(default=70, ge=0, le=100)
    loop: bool = True
    fade_ms: int = Field(default=1000, alias="fadeMs", ge=0, le=60_000)

    @model_validator(mode="before")
    @classmethod
    def defaults_follow_channel(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        if normalized.get("channel") == "sfx":
            normalized.setdefault("volume", 100)
            normalized.setdefault("loop", False)
            normalized.setdefault("fadeMs", 0)
        else:
            normalized.setdefault("volume", 70)
            normalized.setdefault("loop", True)
            normalized.setdefault("fadeMs", 1000)
        return normalized

    @model_validator(mode="after")
    def action_has_valid_asset(self) -> GalgameStoryAudioBlock:
        if self.action == "play" and self.asset_id is None:
            raise ValueError("播放声音时必须选择声音素材")
        if self.action == "stop" and self.asset_id is not None:
            raise ValueError("停止声音时不能指定声音素材")
        return self


class GalgameStoryDestroySceneBlock(GalgameStoryBlockBase):
    type: Literal["destroyScene"]
    at_ms: int | None = Field(default=None, alias="atMs", ge=0)
    duration_ms: int = Field(default=400, alias="durationMs", ge=0, le=60_000)
    wait_for_completion: bool = Field(default=False, alias="waitForCompletion")


class GalgameStoryCameraBlock(GalgameStoryBlockBase):
    type: Literal["camera"]
    at_ms: int | None = Field(default=None, alias="atMs", ge=0)
    target: Literal["stage", "background", "characters", "cg"] = "stage"
    effect: Literal[
        "move",
        "zoom",
        "rotate",
        "shake",
        "shakeHorizontal",
        "shakeVertical",
        "pulse",
        "bounce",
        "swing",
        "wobble",
        "flash",
        "blur",
        "focus",
        "fade",
        "fadeWhite",
        "fadeBlack",
        "panLeft",
        "panRight",
        "panUp",
        "panDown",
        "zoomIn",
        "zoomOut",
        "rollLeft",
        "rollRight",
        "quake",
        "heartbeat",
        "custom",
    ] = "move"
    x: float = Field(default=0, ge=-200, le=200)
    y: float = Field(default=0, ge=-200, le=200)
    scale: float = Field(default=1, ge=0.1, le=10)
    rotation: float = Field(default=0, ge=-1080, le=1080)
    intensity: float = Field(default=1, ge=0, le=10)
    duration_ms: int = Field(default=500, alias="durationMs", ge=0, le=600_000)
    easing: Literal["linear", "ease", "easeIn", "easeOut", "easeInOut"] = "easeInOut"
    wait_for_completion: bool = Field(default=False, alias="waitForCompletion")


class GalgameStoryResetCameraBlock(GalgameStoryBlockBase):
    type: Literal["resetCamera"]
    at_ms: int | None = Field(default=None, alias="atMs", ge=0)
    duration_ms: int = Field(default=300, alias="durationMs", ge=0, le=60_000)
    wait_for_completion: bool = Field(default=False, alias="waitForCompletion")


class GalgameStoryParticleBlock(GalgameStoryBlockBase):
    type: Literal["particle"]
    at_ms: int | None = Field(default=None, alias="atMs", ge=0)
    preset: Literal["rain", "snow", "sakura", "dust", "sparkle", "fire", "custom"] = "rain"
    action: Literal["play", "stop"] = "play"
    density: float = Field(default=1, ge=0, le=5)
    duration_ms: int | None = Field(default=None, alias="durationMs", ge=0, le=3_600_000)
    wait_for_completion: bool = Field(default=False, alias="waitForCompletion")


class GalgameStoryStageAnimationBlock(GalgameStoryBlockBase):
    type: Literal["stageAnimation"]
    at_ms: int | None = Field(default=None, alias="atMs", ge=0)
    target: str = Field(default="stage", min_length=1, max_length=120)
    animation: str = Field(default="fade", min_length=1, max_length=120)
    duration_ms: int = Field(default=500, alias="durationMs", ge=0, le=600_000)
    wait_for_completion: bool = Field(default=False, alias="waitForCompletion")


class GalgameStoryFloatingTextBlock(GalgameStoryBlockBase):
    type: Literal["floatingText"]
    at_ms: int | None = Field(default=None, alias="atMs", ge=0)
    text: str = Field(default="", max_length=20_000)
    x: float = Field(default=50, ge=0, le=100)
    y: float = Field(default=50, ge=0, le=100)
    color: str = Field(default="#FFFFFF", pattern=HEX_COLOR_PATTERN)
    duration_ms: int = Field(default=1500, alias="durationMs", ge=0, le=600_000)
    wait_for_completion: bool = Field(default=False, alias="waitForCompletion")


class GalgameStoryCurtainBlock(GalgameStoryBlockBase):
    type: Literal["curtain"]
    at_ms: int | None = Field(default=None, alias="atMs", ge=0)
    mode: Literal["fullscreen", "letterbox", "pillarbox", "frame"] = "fullscreen"
    action: Literal["show", "hide"] = "show"
    color: str = Field(default="#000000", pattern=HEX_COLOR_PATTERN)
    opacity: float = Field(default=1, ge=0, le=1)
    duration_ms: int = Field(default=400, alias="durationMs", ge=0, le=60_000)
    wait_for_completion: bool = Field(default=False, alias="waitForCompletion")


class GalgameStoryVideoBlock(GalgameStoryBlockBase):
    type: Literal["video"]
    at_ms: int | None = Field(default=None, alias="atMs", ge=0)
    asset_id: str | None = Field(default=None, alias="assetId", pattern=STABLE_ID_PATTERN)
    action: Literal["play", "stop"] = "play"
    loop: bool = False
    volume: int = Field(default=100, ge=0, le=100)
    fit: Literal["cover", "contain"] = "cover"
    wait_for_completion: bool = Field(default=True, alias="waitForCompletion")

    @model_validator(mode="after")
    def action_has_valid_asset(self) -> GalgameStoryVideoBlock:
        if self.action == "play" and self.asset_id is None:
            raise ValueError("播放视频时必须选择视频素材")
        if self.action == "stop" and self.asset_id is not None:
            raise ValueError("停止视频时不能指定视频素材")
        if self.loop and self.wait_for_completion:
            raise ValueError("循环视频不能等待播放完成")
        return self


class GalgameStoryAnimateSpriteBlock(GalgameStoryBlockBase):
    type: Literal["animateSprite"]
    at_ms: int | None = Field(default=None, alias="atMs", ge=0)
    character_id: str = Field(alias="characterId", pattern=STABLE_ID_PATTERN)
    animation: str = Field(default="idle", min_length=1, max_length=120)
    direction: Literal["none", "left", "right", "towardCenter", "awayFromCenter"] = "none"
    intensity: float = Field(default=1, ge=0.1, le=3)
    easing: Literal["linear", "ease", "easeIn", "easeOut", "easeInOut"] = "easeInOut"
    duration_ms: int = Field(default=500, alias="durationMs", ge=0, le=600_000)
    loop: bool = False
    wait_for_completion: bool = Field(default=False, alias="waitForCompletion")


class GalgameStoryAutoPlayBlock(GalgameStoryBlockBase):
    type: Literal["autoPlay"]
    enabled: bool = True
    delay_ms: int = Field(default=1200, alias="delayMs", ge=0, le=600_000)


class GalgameStorySwitchDialogueStyleBlock(GalgameStoryBlockBase):
    type: Literal["switchDialogueStyle"]
    preset: Literal["dark", "light", "accent", "classicGradient", "custom"] = "dark"


class GalgameStoryPortraitStyleRuleBlock(GalgameStoryBlockBase):
    type: Literal["portraitStyleRule"]
    mode: Literal["stage", "solo", "hidden"] = "stage"
    keep_after: bool = Field(default=True, alias="keepAfter")


class GalgameStoryGalleryBlock(GalgameStoryBlockBase):
    type: Literal["gallery"]
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)
    action: Literal["unlockCg", "unlockScene", "unlockMusic"] = "unlockCg"


class GalgameStoryBranchChoice(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    text: str = Field(default="", max_length=1000)
    target_fragment_id: str = Field(alias="targetFragmentId", pattern=STABLE_ID_PATTERN)


class GalgameStoryBranchBlock(GalgameStoryBlockBase):
    type: Literal["branch"]
    prompt: str = Field(default="", max_length=2000)
    choices: list[GalgameStoryBranchChoice] = Field(min_length=2, max_length=12)

    @field_validator("choices")
    @classmethod
    def choice_ids_are_unique(
        cls, choices: list[GalgameStoryBranchChoice]
    ) -> list[GalgameStoryBranchChoice]:
        ids = [choice.id for choice in choices]
        if len(ids) != len(set(ids)):
            raise ValueError("同一分支的选项 ID 不能重复")
        return choices


class GalgameStoryIfBlock(GalgameStoryBlockBase):
    type: Literal["if"]
    condition: str = Field(min_length=1, max_length=2000)
    then_fragment_id: str = Field(alias="thenFragmentId", pattern=STABLE_ID_PATTERN)
    else_fragment_id: str | None = Field(
        default=None, alias="elseFragmentId", pattern=STABLE_ID_PATTERN
    )


class GalgameStorySetVariableBlock(GalgameStoryBlockBase):
    type: Literal["setVariable"]
    variable_id: str = Field(alias="variableId", pattern=STABLE_ID_PATTERN)
    operator: Literal["set", "add", "subtract", "multiply", "divide", "toggle"] = "set"
    value: str | int | float | bool | None = None


class GalgameStoryCallFragmentBlock(GalgameStoryBlockBase):
    type: Literal["callFragment"]
    target_fragment_id: str = Field(alias="targetFragmentId", pattern=STABLE_ID_PATTERN)


class GalgameStoryEndChapterBlock(GalgameStoryBlockBase):
    type: Literal["endChapter"]
    ending_id: str | None = Field(default=None, alias="endingId", pattern=STABLE_ID_PATTERN)
    label: str = Field(default="结束章节", min_length=1, max_length=120)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryReturnToEntryBlock(GalgameStoryBlockBase):
    type: Literal["returnToEntry"]


GalgameStoryBlock = Annotated[
    GalgameStorySceneBlock
    | GalgameStoryShowCgBlock
    | GalgameStoryHideCgBlock
    | GalgameStoryShowCharacterBlock
    | GalgameStorySetStageCastBlock
    | GalgameStoryRemoveCharacterBlock
    | GalgameStoryNarrationBlock
    | GalgameStoryStoryParagraphBlock
    | GalgameStoryParagraphParamsBlock
    | GalgameStorySystemMessageBlock
    | GalgameStoryCommentBlock
    | GalgameStoryWaitBlock
    | GalgameStoryDialogueBlock
    | GalgameStoryAudioBlock
    | GalgameStoryDestroySceneBlock
    | GalgameStoryCameraBlock
    | GalgameStoryResetCameraBlock
    | GalgameStoryParticleBlock
    | GalgameStoryStageAnimationBlock
    | GalgameStoryFloatingTextBlock
    | GalgameStoryCurtainBlock
    | GalgameStoryVideoBlock
    | GalgameStoryAnimateSpriteBlock
    | GalgameStoryAutoPlayBlock
    | GalgameStorySwitchDialogueStyleBlock
    | GalgameStoryPortraitStyleRuleBlock
    | GalgameStoryGalleryBlock
    | GalgameStoryBranchBlock
    | GalgameStoryIfBlock
    | GalgameStorySetVariableBlock
    | GalgameStoryCallFragmentBlock
    | GalgameStoryEndChapterBlock
    | GalgameStoryReturnToEntryBlock,
    Field(discriminator="type"),
]

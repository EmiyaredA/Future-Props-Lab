from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

GalgameWorkshopProjectStatus = Literal["draft", "completed"]
STABLE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]{0,63}$"
HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


def _clean_title(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("名称不能为空")
    return cleaned


class GalgameWorkshopProjectOut(BaseModel):
    id: str
    title: str
    status: GalgameWorkshopProjectStatus
    revision: int
    created_at: str
    updated_at: str


class GalgameWorkshopProjectListOut(BaseModel):
    items: list[GalgameWorkshopProjectOut]


class GalgameWorkshopProjectCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameWorkshopProjectPatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    status: GalgameWorkshopProjectStatus | None = None

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str | None) -> str | None:
        return _clean_title(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self) -> GalgameWorkshopProjectPatchIn:
        if self.title is None and self.status is None:
            raise ValueError("至少需要提供一个修改字段")
        return self


class GalgameStoryModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class GalgameStoryCharacterExpression(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryVoiceProfile(GalgameStoryModel):
    name: str = Field(min_length=1, max_length=120)
    language: str = Field(default="zh-CN", min_length=1, max_length=40)
    description: str = Field(default="", max_length=4000)
    sample_asset_id: str | None = Field(
        default=None, alias="sampleAssetId", pattern=STABLE_ID_PATTERN
    )

    @field_validator("name", "language")
    @classmethod
    def text_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryCharacter(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    expressions: list[GalgameStoryCharacterExpression] = Field(default_factory=list, max_length=100)
    default_expression_id: str | None = Field(
        default=None, alias="defaultExpressionId", pattern=STABLE_ID_PATTERN
    )
    voice_profile: GalgameStoryVoiceProfile | None = Field(default=None, alias="voiceProfile")

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def expressions_are_valid(self) -> GalgameStoryCharacter:
        expression_ids = [expression.id for expression in self.expressions]
        if len(expression_ids) != len(set(expression_ids)):
            raise ValueError("同一角色的表情 ID 不能重复")
        if self.default_expression_id is not None:
            if self.default_expression_id not in set(expression_ids):
                raise ValueError("角色默认表情不存在")
        elif self.expressions:
            raise ValueError("存在立绘表情时必须指定默认表情")
        return self


class GalgameStoryImageAsset(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    type: Literal["image"]
    role: Literal[
        "characterPortrait",
        "sceneBackground",
        "dialogueBox",
        "uiComponent",
    ]
    file_id: str = Field(alias="fileId", min_length=1, max_length=36)
    status: Literal["ready"]

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_ui_roles(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        migrated = dict(value)
        if migrated.get("role") in {
            "dateHud",
            "quickControls",
            "choicePanel",
            "advanceIndicator",
        }:
            migrated["role"] = "uiComponent"
        return migrated


class GalgameStoryAudioAsset(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    type: Literal["audio"]
    role: Literal[
        "voiceSample",
        "voiceLine",
        "backgroundMusic",
        "ambientSound",
        "soundEffect",
        "timelineTrack",
    ]
    label: str = Field(min_length=1, max_length=120)
    file_id: str = Field(alias="fileId", min_length=1, max_length=36)
    status: Literal["ready"]

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


GalgameStoryAsset = Annotated[
    GalgameStoryImageAsset | GalgameStoryAudioAsset,
    Field(discriminator="type"),
]


class GalgameStoryDialogueBoxStyle(GalgameStoryModel):
    preset: Literal["dark", "light", "accent", "custom"] = "dark"
    asset_id: str | None = Field(default=None, alias="assetId", pattern=STABLE_ID_PATTERN)
    background_color: str = Field(
        default="#080E18", alias="backgroundColor", pattern=HEX_COLOR_PATTERN
    )
    text_color: str = Field(default="#FFFFFF", alias="textColor", pattern=HEX_COLOR_PATTERN)
    name_color: str = Field(default="#FFFFFF", alias="nameColor", pattern=HEX_COLOR_PATTERN)
    background_opacity: float = Field(default=0.82, alias="backgroundOpacity", ge=0.2, le=1)
    border_radius: int = Field(default=12, alias="borderRadius", ge=0, le=32)
    font_scale: float = Field(default=1, alias="fontScale", ge=0.8, le=1.4)


class GalgameStoryUiComponent(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    asset_id: str | None = Field(default=None, alias="assetId", pattern=STABLE_ID_PATTERN)
    x: float = Field(default=4, ge=0, le=100)
    y: float = Field(default=4, ge=0, le=100)
    width: float = Field(default=24, ge=1, le=100)
    visibility: Literal["always", "content", "dialogue", "choices"] = "always"
    layer: int = Field(default=1, ge=0, le=20)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryUiStyle(GalgameStoryModel):
    components: list[GalgameStoryUiComponent] = Field(default_factory=list, max_length=100)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_slots(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        migrated = dict(value)
        components = list(migrated.pop("components", []) or [])
        legacy_slots = (
            ("dateHudAssetId", "legacy-date-hud", "日期 HUD", 2, 2, 32, "always", 3),
            (
                "quickControlsAssetId",
                "legacy-quick-controls",
                "快捷控制栏",
                2,
                82,
                23,
                "dialogue",
                5,
            ),
            (
                "choicePanelAssetId",
                "legacy-choice-panel",
                "分支选项底板",
                10,
                34,
                80,
                "choices",
                1,
            ),
            (
                "advanceIndicatorAssetId",
                "legacy-advance-indicator",
                "继续指示符",
                88,
                80,
                5,
                "dialogue",
                5,
            ),
        )
        known_asset_ids = {
            component.get("assetId")
            for component in components
            if isinstance(component, dict) and component.get("assetId")
        }
        for key, component_id, name, x, y, width, visibility, layer in legacy_slots:
            asset_id = migrated.pop(key, None)
            if not asset_id or asset_id in known_asset_ids:
                continue
            components.append(
                {
                    "id": component_id,
                    "name": name,
                    "assetId": asset_id,
                    "x": x,
                    "y": y,
                    "width": width,
                    "visibility": visibility,
                    "layer": layer,
                }
            )
            known_asset_ids.add(asset_id)
        migrated["components"] = components
        return migrated

    @model_validator(mode="after")
    def component_ids_are_unique(self) -> GalgameStoryUiStyle:
        component_ids = [component.id for component in self.components]
        if len(component_ids) != len(set(component_ids)):
            raise ValueError("界面组件 ID 不能重复")
        return self


class GalgameStoryStageStyle(GalgameStoryModel):
    speaker_focus_enabled: bool = Field(default=True, alias="speakerFocusEnabled")
    inactive_brightness: float = Field(default=0.6, alias="inactiveBrightness", ge=0, le=1)
    focus_transition_ms: int = Field(default=180, alias="focusTransitionMs", ge=0, le=5000)
    lip_sync_enabled: bool = Field(default=False, alias="lipSyncEnabled")


class GalgameStoryPresentation(GalgameStoryModel):
    dialogue_box: GalgameStoryDialogueBoxStyle = Field(
        default_factory=GalgameStoryDialogueBoxStyle, alias="dialogueBox"
    )
    ui: GalgameStoryUiStyle = Field(default_factory=GalgameStoryUiStyle)
    stage: GalgameStoryStageStyle = Field(default_factory=GalgameStoryStageStyle)


class GalgameStorySceneBackground(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryScene(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    backgrounds: list[GalgameStorySceneBackground] = Field(default_factory=list, max_length=100)
    default_background_id: str | None = Field(
        default=None, alias="defaultBackgroundId", pattern=STABLE_ID_PATTERN
    )

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def backgrounds_are_valid(self) -> GalgameStoryScene:
        background_ids = [background.id for background in self.backgrounds]
        if len(background_ids) != len(set(background_ids)):
            raise ValueError("同一场景的背景 ID 不能重复")
        if self.default_background_id is not None:
            if self.default_background_id not in set(background_ids):
                raise ValueError("场景默认背景不存在")
        elif self.backgrounds:
            raise ValueError("存在背景状态时必须指定默认背景")
        return self


class GalgameStoryBlockBase(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)


class GalgameStorySceneBlock(GalgameStoryBlockBase):
    type: Literal["scene"]
    at_ms: int | None = Field(
        default=None, alias="atMs", ge=0, exclude_if=lambda value: value is None
    )
    scene_id: str = Field(alias="sceneId", pattern=STABLE_ID_PATTERN)
    background_id: str | None = Field(default=None, alias="backgroundId", pattern=STABLE_ID_PATTERN)
    clear_characters: bool | None = Field(default=None, alias="clearCharacters")

    @field_validator("clear_characters", mode="before")
    @classmethod
    def missing_clear_characters_uses_default(cls, value: Any) -> Any:
        return True if value is None else value


class GalgameStoryCharacterTransform(GalgameStoryModel):
    x: float = Field(default=50, ge=-100, le=200)
    y: float = Field(default=100, ge=-100, le=200)
    scale: float = Field(default=1, ge=0.25, le=3)
    brightness: float = Field(default=1, ge=0, le=2)
    opacity: float = Field(default=1, ge=0, le=1)
    flip_x: bool = Field(default=False, alias="flipX")
    layer: int = Field(default=10, ge=0, le=20)


class GalgameStoryCharacterTransition(GalgameStoryModel):
    duration_ms: int = Field(default=240, alias="durationMs", ge=0, le=5000)
    fade: bool = True


class GalgameStoryDialoguePortrait(GalgameStoryModel):
    mode: Literal["stage", "solo", "hidden"] = "stage"
    keep_after: bool = Field(default=True, alias="keepAfter")
    transform: GalgameStoryCharacterTransform | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    transition: GalgameStoryCharacterTransition = Field(
        default_factory=GalgameStoryCharacterTransition
    )


class GalgameStoryShowCharacterBlock(GalgameStoryBlockBase):
    type: Literal["showCharacter"]
    at_ms: int | None = Field(
        default=None, alias="atMs", ge=0, exclude_if=lambda value: value is None
    )
    character_id: str = Field(alias="characterId", pattern=STABLE_ID_PATTERN)
    expression_id: str | None = Field(default=None, alias="expressionId", pattern=STABLE_ID_PATTERN)
    transform: GalgameStoryCharacterTransform = Field(
        default_factory=GalgameStoryCharacterTransform
    )
    transition: GalgameStoryCharacterTransition = Field(
        default_factory=GalgameStoryCharacterTransition
    )


class GalgameStoryRemoveCharacterBlock(GalgameStoryBlockBase):
    type: Literal["removeCharacter"]
    at_ms: int | None = Field(
        default=None, alias="atMs", ge=0, exclude_if=lambda value: value is None
    )
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


class GalgameStoryNarrationBlock(GalgameStoryTimedBlockBase):
    type: Literal["narration"]
    text: str = Field(default="", max_length=20_000)


class GalgameStoryDialogueBlock(GalgameStoryTimedBlockBase):
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
    text: str = Field(default="", max_length=20_000)
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


class GalgameStoryEndChapterBlock(GalgameStoryBlockBase):
    type: Literal["endChapter"]
    ending_id: str = Field(alias="endingId", pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


GalgameStoryBlock = Annotated[
    GalgameStorySceneBlock
    | GalgameStoryShowCharacterBlock
    | GalgameStoryRemoveCharacterBlock
    | GalgameStoryNarrationBlock
    | GalgameStoryDialogueBlock
    | GalgameStoryAudioBlock
    | GalgameStoryBranchBlock
    | GalgameStoryEndChapterBlock,
    Field(discriminator="type"),
]


class GalgameStoryFragmentTimeline(GalgameStoryModel):
    asset_id: str | None = Field(
        default=None,
        alias="assetId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
        description="可选的剧情校准参考声轨；不参与多轨运行时混音",
    )
    duration_ms: int = Field(
        alias="durationMs",
        ge=1,
        description="剧情时间轴总长（毫秒），独立于所引用声音素材的媒体时长",
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
    fragments: list[GalgameStoryFragment] = Field(default_factory=list, max_length=500)

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryProject(GalgameStoryModel):
    schema_version: Literal["1.0"] = Field(alias="schemaVersion")
    synopsis: str = Field(default="", max_length=10_000)
    characters: list[GalgameStoryCharacter] = Field(default_factory=list, max_length=200)
    scenes: list[GalgameStoryScene] = Field(default_factory=list, max_length=200)
    variables: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    assets: list[GalgameStoryAsset] = Field(default_factory=list, max_length=2000)
    presentation: GalgameStoryPresentation = Field(default_factory=GalgameStoryPresentation)
    chapters: list[GalgameStoryChapter] = Field(default_factory=list, min_length=1, max_length=100)

    @model_validator(mode="after")
    def references_and_ids_are_valid(self) -> GalgameStoryProject:
        character_ids = [character.id for character in self.characters]
        scene_ids = [scene.id for scene in self.scenes]
        chapter_ids = [chapter.id for chapter in self.chapters]
        asset_ids = [asset.id for asset in self.assets]
        if len(character_ids) != len(set(character_ids)):
            raise ValueError("角色 ID 不能重复")
        if len(scene_ids) != len(set(scene_ids)):
            raise ValueError("场景 ID 不能重复")
        if len(chapter_ids) != len(set(chapter_ids)):
            raise ValueError("章节 ID 不能重复")
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("素材 ID 不能重复")

        known_characters = set(character_ids)
        known_scenes = set(scene_ids)
        assets_by_id = {asset.id: asset for asset in self.assets}
        expressions_by_character: dict[str, set[str]] = {}
        for character in self.characters:
            expressions_by_character[character.id] = {
                expression.id for expression in character.expressions
            }
            for expression in character.expressions:
                asset = assets_by_id.get(expression.asset_id)
                if asset is None:
                    raise ValueError("角色表情引用了不存在的立绘素材")
                if asset.role != "characterPortrait":
                    raise ValueError("角色表情只能引用角色立绘素材")
            if (
                character.voice_profile is not None
                and character.voice_profile.sample_asset_id is not None
            ):
                sample = assets_by_id.get(character.voice_profile.sample_asset_id)
                if sample is None:
                    raise ValueError("角色声线引用了不存在的试听样本")
                if sample.role != "voiceSample":
                    raise ValueError("角色声线只能引用试听样本素材")
        backgrounds_by_scene: dict[str, set[str]] = {}
        for scene in self.scenes:
            backgrounds_by_scene[scene.id] = {background.id for background in scene.backgrounds}
            for background in scene.backgrounds:
                asset = assets_by_id.get(background.asset_id)
                if asset is None:
                    raise ValueError("场景背景引用了不存在的背景素材")
                if asset.role != "sceneBackground":
                    raise ValueError("场景背景只能引用场景背景素材")
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
        block_ids: list[str] = []
        ending_ids: list[str] = []
        for chapter in self.chapters:
            fragment_ids = [fragment.id for fragment in chapter.fragments]
            if len(fragment_ids) != len(set(fragment_ids)):
                raise ValueError(f"章节“{chapter.title}”的 Fragment ID 不能重复")
            known_fragments = set(fragment_ids)
            if chapter.entry_fragment_id not in known_fragments:
                raise ValueError(f"章节“{chapter.title}”的入口 Fragment 不存在")
            for fragment in chapter.fragments:
                timeline_asset = None
                if fragment.timeline is not None and fragment.timeline.asset_id is not None:
                    timeline_asset = assets_by_id.get(fragment.timeline.asset_id)
                    if timeline_asset is None:
                        raise ValueError("Fragment 时间轴引用了不存在的声音素材")
                    if timeline_asset.role != "timelineTrack":
                        raise ValueError("Fragment 时间轴只能引用剧情时间轴素材")
                previous_end_ms = 0
                scene_events_at: dict[int, bool] = {}
                character_events_at: dict[int, list[tuple[str, bool]]] = {}
                audio_plays_at: dict[tuple[int, str], bool] = {}
                timed_cues = [
                    (index, block.start_ms)
                    for index, block in enumerate(fragment.blocks)
                    if isinstance(block, (GalgameStoryDialogueBlock, GalgameStoryNarrationBlock))
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
                                GalgameStoryShowCharacterBlock,
                                GalgameStoryRemoveCharacterBlock,
                                GalgameStoryAudioBlock,
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
                            GalgameStoryShowCharacterBlock,
                            GalgameStoryRemoveCharacterBlock,
                            GalgameStoryAudioBlock,
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
                    if isinstance(block, (GalgameStoryDialogueBlock, GalgameStoryNarrationBlock)):
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
                        if (
                            block.background_id is not None
                            and block.background_id not in backgrounds_by_scene[block.scene_id]
                        ):
                            raise ValueError("场景 Block 引用了不属于当前场景的背景")
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
                    elif isinstance(block, GalgameStoryBranchBlock):
                        if any(
                            choice.target_fragment_id not in known_fragments
                            for choice in block.choices
                        ):
                            raise ValueError("分支选项引用了当前章节外的 Fragment")
                    elif isinstance(block, GalgameStoryEndChapterBlock):
                        ending_ids.append(block.ending_id)
        if len(block_ids) != len(set(block_ids)):
            raise ValueError("Block ID 必须在整个工程内唯一")
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


class GalgameProjectAssetOut(BaseModel):
    id: str
    display_name: str
    media_kind: Literal["image", "audio"]
    mime_type: str
    byte_size: int
    revision: int
    created_at: str
    updated_at: str


class GalgameProjectAssetListOut(BaseModel):
    items: list[GalgameProjectAssetOut]


class GalgameStoryReportIssue(BaseModel):
    code: str
    message: str
    path: str
    chapter_id: str | None = None
    fragment_id: str | None = None
    block_id: str | None = None


class GalgameStoryChapterReport(BaseModel):
    chapter_id: str
    reachable_fragment_ids: list[str]
    unreachable_fragment_ids: list[str]
    ending_ids: list[str]
    cycles: list[list[str]]


class GalgameStoryRouteReportOut(BaseModel):
    project_id: str
    story_revision: int
    ready: bool
    errors: list[GalgameStoryReportIssue]
    warnings: list[GalgameStoryReportIssue]
    chapters: list[GalgameStoryChapterReport]

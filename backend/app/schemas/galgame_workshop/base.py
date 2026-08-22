from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.galgame_workshop.base_core import (
    CHARACTER_THEME_PALETTE,
    HEX_COLOR_PATTERN,
    STABLE_ID_PATTERN,
    GalgameStoryModel,
    _clean_title,
)
from app.schemas.galgame_workshop.dialogue_box import (
    GalgameStoryDialogueBoxAdvanceIndicator,
    GalgameStoryDialogueBoxBackground,
    GalgameStoryDialogueBoxBody,
    GalgameStoryDialogueBoxLayout,
    GalgameStoryDialogueBoxSpeakerName,
)

GalgameWorkshopProjectStatus = Literal["draft", "completed"]


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


class GalgameStoryImageCrop(GalgameStoryModel):
    x: float = Field(default=50, ge=0, le=100)
    y: float = Field(default=25, ge=0, le=100)
    scale: float = Field(default=1.8, ge=0.5, le=6)


class GalgameStoryExpressionAvatar(GalgameStoryModel):
    source: Literal["portrait", "independent"] = "portrait"
    asset_id: str | None = Field(
        default=None,
        alias="assetId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    crop: GalgameStoryImageCrop = Field(default_factory=GalgameStoryImageCrop)

    @model_validator(mode="after")
    def independent_avatar_has_asset(self) -> GalgameStoryExpressionAvatar:
        if self.source == "independent" and self.asset_id is None:
            raise ValueError("独立对白头像必须绑定图片素材")
        if self.source == "portrait" and self.asset_id is not None:
            raise ValueError("跟随立绘的对白头像不能绑定独立素材")
        return self


class GalgameStoryCharacterOverlay(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)
    x: float = Field(default=50, ge=-100, le=200)
    y: float = Field(default=50, ge=-100, le=200)
    width: float = Field(default=100, gt=0, le=400)
    opacity: float = Field(default=1, ge=0, le=1)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryExpressionFrame(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)


class GalgameStoryExpressionSequence(GalgameStoryModel):
    playback_mode: Literal["timed", "lipSync"] = Field(default="timed", alias="playbackMode")
    fps: int = Field(default=2, ge=1, le=60)
    loop: bool = True
    frames: list[GalgameStoryExpressionFrame] = Field(min_length=1, max_length=240)

    @model_validator(mode="after")
    def frame_ids_are_unique(self) -> GalgameStoryExpressionSequence:
        frame_ids = [frame.id for frame in self.frames]
        if len(frame_ids) != len(set(frame_ids)):
            raise ValueError("同一表情序列的帧 ID 不能重复")
        if self.playback_mode == "lipSync" and len(self.frames) != 3:
            raise ValueError("语音口型序列必须依次保存闭口、半口和张口三帧")
        return self


class GalgameStoryCharacterExpression(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)
    render_mode: Literal["staticImage", "frameSequence"] = Field(
        default="staticImage", alias="renderMode"
    )
    sequence: GalgameStoryExpressionSequence | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    flip_x: bool = Field(default=False, alias="flipX")
    thumbnail_crop: GalgameStoryImageCrop = Field(
        default_factory=GalgameStoryImageCrop, alias="thumbnailCrop"
    )
    dialogue_avatar: GalgameStoryExpressionAvatar = Field(
        default_factory=GalgameStoryExpressionAvatar, alias="dialogueAvatar"
    )
    height_percent: float | None = Field(
        default=None,
        alias="heightPercent",
        gt=0,
        le=400,
        exclude_if=lambda value: value is None,
    )
    overlays: list[GalgameStoryCharacterOverlay] = Field(default_factory=list, max_length=20)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def presentation_is_valid(self) -> GalgameStoryCharacterExpression:
        overlay_ids = [overlay.id for overlay in self.overlays]
        if len(overlay_ids) != len(set(overlay_ids)):
            raise ValueError("同一表情的图形覆盖 ID 不能重复")
        if self.render_mode == "staticImage" and self.sequence is not None:
            raise ValueError("静态图片表情不能保存序列帧配置")
        if self.render_mode == "frameSequence":
            if self.sequence is None:
                raise ValueError("序列帧表情必须保存序列帧配置")
            if self.asset_id != self.sequence.frames[0].asset_id:
                raise ValueError("序列帧表情的代表素材必须与首帧一致")
        return self


class GalgameStoryCharacterDisplayName(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)
    source: Literal["literal", "variable", "attribute"] = "literal"
    value: str | None = Field(default=None, max_length=120)
    variable_id: str | None = Field(
        default=None,
        alias="variableId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    attribute_id: str | None = Field(
        default=None,
        alias="attributeId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )

    @model_validator(mode="after")
    def source_has_value(self) -> GalgameStoryCharacterDisplayName:
        if self.source == "literal" and not (self.value or "").strip():
            raise ValueError("固定显示名不能为空")
        if self.source == "literal" and (
            self.variable_id is not None or self.attribute_id is not None
        ):
            raise ValueError("固定显示名不能绑定变量或角色属性")
        if self.source == "variable" and self.variable_id is None:
            raise ValueError("变量显示名必须绑定变量")
        if self.source == "variable" and self.attribute_id is not None:
            raise ValueError("变量显示名不能同时绑定角色属性")
        if self.source == "attribute" and self.attribute_id is None:
            raise ValueError("角色属性显示名必须绑定属性")
        if self.source == "attribute" and self.variable_id is not None:
            raise ValueError("角色属性显示名不能同时绑定变量")
        return self


class GalgameStoryDialogueAvatarSettings(GalgameStoryModel):
    enabled: bool = False


class GalgameStoryPortraitSkinOverride(GalgameStoryModel):
    expression_id: str = Field(alias="expressionId", pattern=STABLE_ID_PATTERN)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)


class GalgameStoryPortraitSkin(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    overrides: list[GalgameStoryPortraitSkinOverride] = Field(default_factory=list, max_length=100)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def expression_ids_are_unique(self) -> GalgameStoryPortraitSkin:
        expression_ids = [item.expression_id for item in self.overrides]
        if len(expression_ids) != len(set(expression_ids)):
            raise ValueError("同一立绘皮肤不能重复覆盖同一表情")
        return self


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
    theme_color: str = Field(
        default=CHARACTER_THEME_PALETTE[0],
        alias="themeColor",
        pattern=HEX_COLOR_PATTERN,
    )
    expressions: list[GalgameStoryCharacterExpression] = Field(default_factory=list, max_length=100)
    default_expression_id: str | None = Field(
        default=None, alias="defaultExpressionId", pattern=STABLE_ID_PATTERN
    )
    voice_profile: GalgameStoryVoiceProfile | None = Field(default=None, alias="voiceProfile")
    display_names: list[GalgameStoryCharacterDisplayName] = Field(
        default_factory=list, alias="displayNames", max_length=100
    )
    default_display_name_id: str | None = Field(
        default=None, alias="defaultDisplayNameId", pattern=STABLE_ID_PATTERN
    )
    dialogue_avatar: GalgameStoryDialogueAvatarSettings = Field(
        default_factory=GalgameStoryDialogueAvatarSettings, alias="dialogueAvatar"
    )
    portrait_skins: list[GalgameStoryPortraitSkin] = Field(
        default_factory=list, alias="portraitSkins", max_length=100
    )
    default_portrait_skin_id: str | None = Field(
        default=None, alias="defaultPortraitSkinId", pattern=STABLE_ID_PATTERN
    )
    portrait_height_percent: float | None = Field(
        default=None,
        alias="portraitHeightPercent",
        gt=0,
        le=400,
        exclude_if=lambda value: value is None,
    )
    attributes: dict[str, str | int | float | bool] = Field(default_factory=dict)

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
        display_name_ids = [item.id for item in self.display_names]
        if len(display_name_ids) != len(set(display_name_ids)):
            raise ValueError("同一角色的显示名方案 ID 不能重复")
        if self.default_display_name_id is not None:
            if self.default_display_name_id not in set(display_name_ids):
                raise ValueError("角色默认显示名方案不存在")
        skin_ids = [skin.id for skin in self.portrait_skins]
        if len(skin_ids) != len(set(skin_ids)):
            raise ValueError("同一角色的立绘皮肤 ID 不能重复")
        if self.default_portrait_skin_id is not None:
            if self.default_portrait_skin_id not in set(skin_ids):
                raise ValueError("角色默认立绘皮肤不存在")
        return self


class GalgameStoryImageAsset(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    type: Literal["image"]
    role: Literal[
        "characterPortrait",
        "dialogueAvatar",
        "characterOverlay",
        "sceneLayer",
        "storyCg",
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
        elif migrated.get("role") == "sceneBackground":
            migrated["role"] = "sceneLayer"
        return migrated


class GalgameStoryAudioAsset(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    type: Literal["audio"]
    role: Literal[
        "voiceSample",
        "voiceLine",
        "timelineMaster",
        "backgroundMusic",
        "ambientSound",
        "soundEffect",
    ]
    label: str = Field(min_length=1, max_length=120)
    file_id: str = Field(alias="fileId", min_length=1, max_length=36)
    status: Literal["ready"]

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryVideoAsset(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    type: Literal["video"]
    role: Literal["video"] = "video"
    label: str = Field(min_length=1, max_length=120)
    file_id: str = Field(alias="fileId", min_length=1, max_length=36)
    status: Literal["ready"]

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


GalgameStoryAsset = Annotated[
    GalgameStoryImageAsset | GalgameStoryAudioAsset | GalgameStoryVideoAsset,
    Field(discriminator="type"),
]


class GalgameStoryDialogueBoxStyle(GalgameStoryModel):
    preset: Literal["dark", "light", "accent", "classicGradient", "custom"] = "dark"
    asset_id: str | None = Field(default=None, alias="assetId", pattern=STABLE_ID_PATTERN)
    background_color: str = Field(
        default="#080E18", alias="backgroundColor", pattern=HEX_COLOR_PATTERN
    )
    text_color: str = Field(default="#FFFFFF", alias="textColor", pattern=HEX_COLOR_PATTERN)
    name_color: str = Field(default="#FFFFFF", alias="nameColor", pattern=HEX_COLOR_PATTERN)
    background_opacity: float = Field(default=0.82, alias="backgroundOpacity", ge=0.2, le=1)
    border_radius: int = Field(default=12, alias="borderRadius", ge=0, le=32)
    font_scale: float = Field(default=1, alias="fontScale", ge=0.8, le=1.4)
    layout: GalgameStoryDialogueBoxLayout = Field(default_factory=GalgameStoryDialogueBoxLayout)
    background: GalgameStoryDialogueBoxBackground = Field(
        default_factory=GalgameStoryDialogueBoxBackground
    )
    body: GalgameStoryDialogueBoxBody = Field(default_factory=GalgameStoryDialogueBoxBody)
    speaker_name: GalgameStoryDialogueBoxSpeakerName = Field(
        default_factory=GalgameStoryDialogueBoxSpeakerName, alias="speakerName"
    )
    advance_indicator: GalgameStoryDialogueBoxAdvanceIndicator = Field(
        default_factory=GalgameStoryDialogueBoxAdvanceIndicator,
        alias="advanceIndicator",
    )


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


class GalgameStorySourceRef(GalgameStoryModel):
    source: Literal["builtin", "project", "extension"] = "builtin"
    id: str = Field(min_length=1, max_length=160)


class GalgameStoryTextPlaybackStyle(GalgameStoryModel):
    default_speed_cps: int = Field(default=40, alias="defaultSpeedCps", ge=1, le=240)


class GalgameStoryParagraphStyle(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    font_size_px: int = Field(default=32, alias="fontSizePx", ge=8, le=200)
    line_height: float = Field(default=1.8, alias="lineHeight", ge=1, le=3)
    text_color: str = Field(default="#FFFFFF", alias="textColor", pattern=HEX_COLOR_PATTERN)
    read_text_color: str = Field(
        default="#9CA3AF", alias="readTextColor", pattern=HEX_COLOR_PATTERN
    )
    background_color: str = Field(
        default="#080E18", alias="backgroundColor", pattern=HEX_COLOR_PATTERN
    )
    content_width: int = Field(default=72, alias="contentWidth", ge=30, le=100)
    align: Literal["left", "center", "right"] = "left"

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryParagraphPresentation(GalgameStoryModel):
    default_style_ref: GalgameStorySourceRef = Field(
        default_factory=lambda: GalgameStorySourceRef(source="builtin", id="classic"),
        alias="defaultStyleRef",
    )
    custom_styles: list[GalgameStoryParagraphStyle] = Field(
        default_factory=list, alias="customStyles", max_length=100
    )

    @model_validator(mode="after")
    def style_ids_are_unique(self) -> GalgameStoryParagraphPresentation:
        style_ids = [style.id for style in self.custom_styles]
        if len(style_ids) != len(set(style_ids)):
            raise ValueError("项目段落样式 ID 不能重复")
        return self


class GalgameStorySystemMessageStyle(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    asset_id: str | None = Field(
        default=None,
        alias="assetId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    panel_color: str = Field(default="#FFFFFF", alias="panelColor", pattern=HEX_COLOR_PATTERN)
    title_color: str = Field(default="#111827", alias="titleColor", pattern=HEX_COLOR_PATTERN)
    text_color: str = Field(default="#374151", alias="textColor", pattern=HEX_COLOR_PATTERN)
    accent_color: str = Field(default="#E75B55", alias="accentColor", pattern=HEX_COLOR_PATTERN)
    border_radius: int = Field(default=12, alias="borderRadius", ge=0, le=40)
    width: int = Field(default=520, ge=280, le=1200)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStorySystemMessagePresentation(GalgameStoryModel):
    binding: GalgameStorySourceRef = Field(
        default_factory=lambda: GalgameStorySourceRef(source="builtin", id="standard-message")
    )
    custom_styles: list[GalgameStorySystemMessageStyle] = Field(
        default_factory=list, alias="customStyles", max_length=100
    )

    @model_validator(mode="after")
    def style_ids_are_unique(self) -> GalgameStorySystemMessagePresentation:
        style_ids = [style.id for style in self.custom_styles]
        if len(style_ids) != len(set(style_ids)):
            raise ValueError("项目消息框样式 ID 不能重复")
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
    text: GalgameStoryTextPlaybackStyle = Field(default_factory=GalgameStoryTextPlaybackStyle)
    paragraph: GalgameStoryParagraphPresentation = Field(
        default_factory=GalgameStoryParagraphPresentation
    )
    system_message: GalgameStorySystemMessagePresentation = Field(
        default_factory=GalgameStorySystemMessagePresentation, alias="systemMessage"
    )


class GalgameStorySceneGroup(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    color: str = Field(default="#7586E5", pattern=HEX_COLOR_PATTERN)
    collapsed: bool = False

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStorySceneLayer(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)
    distance: float = Field(default=1, gt=0, le=100)
    offset_x: float = Field(default=0, alias="offsetX", ge=-200, le=200)
    offset_y: float = Field(default=0, alias="offsetY", ge=-200, le=200)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryScene(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    group_id: str | None = Field(
        default=None,
        alias="groupId",
        pattern=STABLE_ID_PATTERN,
        exclude_if=lambda value: value is None,
    )
    layers: list[GalgameStorySceneLayer] = Field(default_factory=list, max_length=100)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def layers_are_valid(self) -> GalgameStoryScene:
        layer_ids = [layer.id for layer in self.layers]
        if len(layer_ids) != len(set(layer_ids)):
            raise ValueError("同一场景的图层 ID 不能重复")
        return self


class GalgameStoryCgVariant(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class GalgameStoryCg(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    variants: list[GalgameStoryCgVariant] = Field(default_factory=list, max_length=100)
    default_variant_id: str | None = Field(
        default=None, alias="defaultVariantId", pattern=STABLE_ID_PATTERN
    )

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def variants_are_valid(self) -> GalgameStoryCg:
        variant_ids = [variant.id for variant in self.variants]
        if len(variant_ids) != len(set(variant_ids)):
            raise ValueError("同一 CG 的差分 ID 不能重复")
        if self.default_variant_id is not None:
            if self.default_variant_id not in set(variant_ids):
                raise ValueError("CG 默认差分不存在")
        elif self.variants:
            raise ValueError("存在 CG 差分时必须指定默认差分")
        return self


class GalgameStoryVariable(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    type: Literal["string", "number", "boolean"]
    default_value: str | int | float | bool = Field(alias="defaultValue")
    persistence: Literal["session", "project"] = "session"
    description: str = Field(default="", max_length=2000)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_variable_fields(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        migrated = dict(value)
        display_name = migrated.pop("displayName", None)
        if display_name is not None:
            migrated["name"] = display_name
        legacy_default = migrated.pop("default", None)
        if "defaultValue" not in migrated and legacy_default is not None:
            migrated["defaultValue"] = legacy_default
        legacy_scope = migrated.pop("scope", None)
        persistence = migrated.get("persistence", legacy_scope)
        if persistence in {"slot", "shared"}:
            migrated["persistence"] = {
                "slot": "session",
                "shared": "project",
            }[persistence]
        return migrated

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def default_matches_type(self) -> GalgameStoryVariable:
        matches = {
            "string": isinstance(self.default_value, str),
            "number": isinstance(self.default_value, (int, float))
            and not isinstance(self.default_value, bool),
            "boolean": isinstance(self.default_value, bool),
        }
        if not matches[self.type]:
            raise ValueError("变量默认值必须与声明类型一致")
        return self


class GalgameStoryCharacterAttributeTemplate(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    type: Literal["string", "number", "boolean"]
    default_value: str | int | float | bool = Field(alias="defaultValue")
    description: str = Field(default="", max_length=2000)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)

    @model_validator(mode="after")
    def default_matches_type(self) -> GalgameStoryCharacterAttributeTemplate:
        matches = {
            "string": isinstance(self.default_value, str),
            "number": isinstance(self.default_value, (int, float))
            and not isinstance(self.default_value, bool),
            "boolean": isinstance(self.default_value, bool),
        }
        if not matches[self.type]:
            raise ValueError("角色属性默认值必须与声明类型一致")
        return self

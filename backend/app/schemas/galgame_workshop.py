from __future__ import annotations

import hashlib
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

GalgameWorkshopProjectStatus = Literal["draft", "completed"]
STABLE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]{0,63}$"
HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"
CHARACTER_THEME_PALETTE = (
    "#E75B55",
    "#4AA3DF",
    "#46B978",
    "#A56DE2",
    "#E59B3D",
    "#D85E9D",
    "#32A6A0",
    "#7586E5",
)


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


class GalgameStoryCharacterExpression(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(alias="assetId", pattern=STABLE_ID_PATTERN)
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
    def overlay_ids_are_unique(self) -> GalgameStoryCharacterExpression:
        overlay_ids = [overlay.id for overlay in self.overlays]
        if len(overlay_ids) != len(set(overlay_ids)):
            raise ValueError("同一表情的图形覆盖 ID 不能重复")
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


class GalgameStoryCanvasSettings(GalgameStoryModel):
    width: int = Field(default=1920, ge=640, le=7680)
    height: int = Field(default=1080, ge=360, le=4320)


class GalgameStoryStagePositions(GalgameStoryModel):
    left: float = Field(default=15, ge=0, le=100)
    center_left: float = Field(default=32.5, alias="centerLeft", ge=0, le=100)
    center: float = Field(default=50, ge=0, le=100)
    center_right: float = Field(default=67.5, alias="centerRight", ge=0, le=100)
    right: float = Field(default=85, ge=0, le=100)

    @model_validator(mode="after")
    def positions_are_ordered(self) -> GalgameStoryStagePositions:
        values = [self.left, self.center_left, self.center, self.center_right, self.right]
        if values != sorted(values) or len(set(values)) != len(values):
            raise ValueError("角色标准站位必须从左到右严格递增")
        return self


class GalgameStoryCharacterStageSettings(GalgameStoryModel):
    anchor_x: float = Field(default=50, alias="anchorX", ge=0, le=100)
    anchor_y: float = Field(default=100, alias="anchorY", ge=0, le=100)
    default_height_percent: float = Field(default=100, alias="defaultHeightPercent", gt=0, le=400)
    legacy_default_scale: float | None = Field(
        default=None,
        alias="legacyDefaultScale",
        gt=0,
        le=4,
        exclude_if=lambda value: value is None,
    )
    positions: GalgameStoryStagePositions = Field(default_factory=GalgameStoryStagePositions)


class GalgameStorySettings(GalgameStoryModel):
    canvas: GalgameStoryCanvasSettings = Field(default_factory=GalgameStoryCanvasSettings)
    character_stage: GalgameStoryCharacterStageSettings = Field(
        default_factory=GalgameStoryCharacterStageSettings,
        alias="characterStage",
    )


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


class GalgameStoryBlockBase(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)


class GalgameStorySceneBlock(GalgameStoryBlockBase):
    type: Literal["scene"]
    at_ms: int | None = Field(
        default=None, alias="atMs", ge=0, exclude_if=lambda value: value is None
    )
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
    at_ms: int | None = Field(
        default=None, alias="atMs", ge=0, exclude_if=lambda value: value is None
    )
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
    at_ms: int | None = Field(
        default=None, alias="atMs", ge=0, exclude_if=lambda value: value is None
    )
    transition: GalgameStoryCgTransition = Field(default_factory=GalgameStoryCgTransition)


class GalgameStoryCharacterTransform(GalgameStoryModel):
    x: float = Field(default=50, ge=-1000, le=1000)
    y: float = Field(default=100, ge=-1000, le=1000)
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
    duration_ms: int = Field(default=500, alias="durationMs", ge=0, le=600_000)
    loop: bool = False
    wait_for_completion: bool = Field(default=False, alias="waitForCompletion")


class GalgameStoryAutoPlayBlock(GalgameStoryBlockBase):
    type: Literal["autoPlay"]
    enabled: bool = True
    delay_ms: int = Field(default=1200, alias="delayMs", ge=0, le=600_000)


class GalgameStorySwitchDialogueStyleBlock(GalgameStoryBlockBase):
    type: Literal["switchDialogueStyle"]
    preset: Literal["dark", "light", "accent", "custom"] = "dark"


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
    schema_version: Literal["1.2"] = Field(alias="schemaVersion")
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
        if source_version in {None, "1.0", "1.1"}:
            migrated["schemaVersion"] = "1.2"
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


class GalgameProjectAssetOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    display_name: str
    media_kind: Literal["image", "audio", "video", "font"]
    mime_type: str
    byte_size: int
    revision: int
    created_at: str
    updated_at: str
    category: Literal[
        "character", "scene", "cg", "bgm", "ambient", "sfx", "voice", "video", "font", "other"
    ] = "other"
    virtual_path: str = Field(default="", alias="virtualPath")
    packaging_policy: Literal["auto", "include", "exclude"] = Field(
        default="auto", alias="packagingPolicy"
    )
    checksum_sha256: str | None = Field(default=None, alias="checksumSha256")
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = Field(default=None, alias="durationMs")
    transcript: str | None = None
    transcript_language: str | None = Field(default=None, alias="transcriptLanguage")
    transcript_status: Literal["pending", "queued", "running", "ready", "failed"] = Field(
        default="pending", alias="transcriptStatus"
    )
    transcript_source: Literal["asr", "manual"] | None = Field(
        default=None, alias="transcriptSource"
    )
    transcript_revision: int = Field(default=0, alias="transcriptRevision")


class GalgameProjectAssetListOut(BaseModel):
    items: list[GalgameProjectAssetOut]


GalgameAssetCategory = Literal[
    "character", "scene", "cg", "bgm", "ambient", "sfx", "voice", "video", "font", "other"
]
GalgameAssetPackagingPolicy = Literal["auto", "include", "exclude"]


class GalgameAssetImportPreviewIn(GalgameStoryModel):
    filenames: list[str] = Field(min_length=1, max_length=500)
    category: GalgameAssetCategory


class GalgameAssetImportPreviewItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    original_name: str = Field(alias="originalName")
    final_name: str = Field(alias="finalName")
    virtual_path: str = Field(alias="virtualPath")
    reasons: list[str] = Field(default_factory=list)


class GalgameAssetImportPreviewOut(BaseModel):
    items: list[GalgameAssetImportPreviewItem]


class GalgameAssetBatchUploadOut(BaseModel):
    items: list[GalgameProjectAssetOut]
    import_items: list[GalgameAssetImportPreviewItem] = Field(alias="importItems")


class GalgameProjectAssetPatchIn(GalgameStoryModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    display_name: str | None = Field(
        default=None, alias="displayName", min_length=1, max_length=255
    )
    category: GalgameAssetCategory | None = None
    virtual_path: str | None = Field(
        default=None, alias="virtualPath", min_length=1, max_length=512
    )
    packaging_policy: GalgameAssetPackagingPolicy | None = Field(
        default=None, alias="packagingPolicy"
    )

    @model_validator(mode="after")
    def has_change(self) -> GalgameProjectAssetPatchIn:
        if all(
            value is None
            for value in (
                self.display_name,
                self.category,
                self.virtual_path,
                self.packaging_policy,
            )
        ):
            raise ValueError("至少需要提供一个修改字段")
        return self


class GalgamePackageManifestItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    asset_id: str = Field(alias="assetId")
    virtual_path: str = Field(alias="virtualPath")
    byte_size: int = Field(alias="byteSize")
    reason: Literal["referenced", "forced"]


class GalgamePackageManifestIssue(BaseModel):
    code: str
    asset_id: str | None = Field(default=None, alias="assetId")
    story_asset_id: str | None = Field(default=None, alias="storyAssetId")
    message: str


class GalgamePackageManifestOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    ready: bool
    total_bytes: int = Field(alias="totalBytes")
    items: list[GalgamePackageManifestItem]
    issues: list[GalgamePackageManifestIssue]


class GalgameMissingAssetRepairIn(GalgameStoryModel):
    expected_story_revision: int = Field(alias="expectedStoryRevision", ge=0)
    story_asset_id: str = Field(alias="storyAssetId", pattern=STABLE_ID_PATTERN)
    replacement_file_id: str = Field(alias="replacementFileId", min_length=1, max_length=36)


class GalgameAsrSettingsPatchIn(GalgameStoryModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    model_id: str | None = Field(default=None, alias="modelId", max_length=36)
    default_language: Literal["auto", "zh", "ja"] | None = Field(
        default=None, alias="defaultLanguage"
    )
    concurrency: int | None = Field(default=None, ge=1, le=8)


class GalgameAsrSettingsOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    model_id: str | None = Field(alias="modelId")
    model_ready: bool = Field(alias="modelReady")
    default_language: Literal["auto", "zh", "ja"] = Field(alias="defaultLanguage")
    concurrency: int
    revision: int


class GalgameTranscriptionCreateIn(GalgameStoryModel):
    asset_ids: list[str] | None = Field(default=None, alias="assetIds", max_length=500)
    language: Literal["auto", "zh", "ja"] | None = None
    force: bool = False


class GalgameTranscriptionTaskOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    asset_id: str = Field(alias="assetId")
    provider_name: str = Field(alias="providerName")
    model_slug: str = Field(alias="modelSlug")
    language: Literal["auto", "zh", "ja"]
    force: bool
    status: Literal["queued", "running", "completed", "failed"]
    result_text: str | None = Field(default=None, alias="resultText")
    error: str | None = None
    revision: int
    created_at: str = Field(alias="createdAt")
    started_at: str | None = Field(default=None, alias="startedAt")
    finished_at: str | None = Field(default=None, alias="finishedAt")


class GalgameTranscriptionTaskListOut(BaseModel):
    items: list[GalgameTranscriptionTaskOut]


class GalgameTranscriptPatchIn(GalgameStoryModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    text: str = Field(max_length=20_000)
    language: Literal["auto", "zh", "ja"] | None = None


class GalgameVoiceMatchIn(GalgameStoryModel):
    expected_story_revision: int = Field(alias="expectedStoryRevision", ge=0)
    asset_ids: list[str] | None = Field(default=None, alias="assetIds", max_length=500)
    minimum_similarity: float = Field(default=0.72, alias="minimumSimilarity", ge=0, le=1)


class GalgameVoiceMatchItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    asset_id: str = Field(alias="assetId")
    block_id: str = Field(alias="blockId")
    similarity: float


class GalgameVoiceMatchOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    story_revision: int = Field(alias="storyRevision")
    matches: list[GalgameVoiceMatchItem]
    unmatched_asset_ids: list[str] = Field(alias="unmatchedAssetIds")


class GalgamePortraitUpgradeItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    expression_id: str = Field(alias="expressionId")
    current_height_percent: float | None = Field(alias="currentHeightPercent")
    target_height_percent: float | None = Field(alias="targetHeightPercent")
    status: Literal["ready", "missing_metadata"]


class GalgamePortraitUpgradePreviewOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    story_revision: int = Field(alias="storyRevision")
    items: list[GalgamePortraitUpgradeItem]


class GalgamePortraitUpgradeApplyIn(GalgameStoryModel):
    expected_story_revision: int = Field(alias="expectedStoryRevision", ge=0)


class GalgameStorySnapshotOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    story_revision: int = Field(alias="storyRevision")
    reason: str
    created_at: str = Field(alias="createdAt")


class GalgameStorySnapshotRestoreIn(GalgameStoryModel):
    expected_story_revision: int = Field(alias="expectedStoryRevision", ge=0)


class GalgameAssetReferenceLocation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: str
    label: str
    chapter_id: str | None = Field(default=None, alias="chapterId")
    fragment_id: str | None = Field(default=None, alias="fragmentId")
    block_id: str | None = Field(default=None, alias="blockId")
    character_id: str | None = Field(default=None, alias="characterId")
    scene_id: str | None = Field(default=None, alias="sceneId")
    cg_id: str | None = Field(default=None, alias="cgId")


class GalgameAssetOverviewItem(GalgameProjectAssetOut):
    category: Literal[
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
    ]
    story_asset_id: str | None = None
    story_role: str | None = None
    bound_character_ids: list[str] = Field(default_factory=list)
    reference_count: int = 0
    references: list[GalgameAssetReferenceLocation] = Field(default_factory=list)
    orphaned: bool = False
    missing: bool = False


class GalgameMissingAssetOverviewItem(BaseModel):
    story_asset_id: str
    file_id: str
    story_role: str
    references: list[GalgameAssetReferenceLocation] = Field(default_factory=list)
    missing: Literal[True] = True


class GalgameAssetOverviewOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    items: list[GalgameAssetOverviewItem]
    missing_items: list[GalgameMissingAssetOverviewItem]
    total_bytes: int = Field(default=0, alias="totalBytes")
    referenced_count: int = Field(default=0, alias="referencedCount")
    orphaned_count: int = Field(default=0, alias="orphanedCount")
    estimated_package_bytes: int = Field(default=0, alias="estimatedPackageBytes")
    type_distribution: dict[str, int] = Field(default_factory=dict, alias="typeDistribution")
    largest_asset_ids: list[str] = Field(default_factory=list, alias="largestAssetIds")
    module_health: dict[str, str] = Field(default_factory=dict, alias="moduleHealth")


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

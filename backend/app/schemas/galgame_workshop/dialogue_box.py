from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.galgame_workshop.base_core import HEX_COLOR_PATTERN, GalgameStoryModel


class GalgameStoryDialogueBoxLayout(GalgameStoryModel):
    mode: Literal["boxed", "bottomOverlay"] = "boxed"
    width_percent: float = Field(default=100, alias="widthPercent", ge=40, le=100)
    height_percent: float = Field(default=22, alias="heightPercent", ge=12, le=50)
    bottom_offset_percent: float = Field(default=0, alias="bottomOffsetPercent", ge=0, le=30)
    content_inset_x_percent: float = Field(default=0, alias="contentInsetXPercent", ge=0, le=25)
    content_inset_top_percent: float = Field(default=0, alias="contentInsetTopPercent", ge=0, le=40)
    content_inset_bottom_percent: float = Field(
        default=0, alias="contentInsetBottomPercent", ge=0, le=30
    )


class GalgameStoryDialogueBoxBackground(GalgameStoryModel):
    mode: Literal["solid", "verticalGradient"] = "solid"
    gradient_top_opacity: float = Field(default=0.2, alias="gradientTopOpacity", ge=0, le=1)
    gradient_bottom_opacity: float = Field(default=0.94, alias="gradientBottomOpacity", ge=0, le=1)
    top_rule: Literal["none", "single", "double"] = Field(default="none", alias="topRule")
    top_rule_color: str = Field(default="#FFFFFF", alias="topRuleColor", pattern=HEX_COLOR_PATTERN)
    top_rule_opacity: float = Field(default=0.22, alias="topRuleOpacity", ge=0, le=1)


class GalgameStoryDialogueBoxBody(GalgameStoryModel):
    font_size_px: int | None = Field(default=None, alias="fontSizePx", ge=12, le=96)
    line_height: float = Field(default=1.35, alias="lineHeight", ge=1, le=2.5)
    align: Literal["left", "center", "right"] = "left"
    max_width_percent: float = Field(default=100, alias="maxWidthPercent", ge=30, le=100)


class GalgameStoryDialogueBoxSpeakerName(GalgameStoryModel):
    placement: Literal["topLeft", "topCenter", "bottomLeft", "bottomCenter", "hidden"] = "topLeft"
    font_size_px: int | None = Field(default=None, alias="fontSizePx", ge=10, le=72)
    decoration: Literal["none", "sideLines"] = "none"


class GalgameStoryDialogueBoxAdvanceIndicator(GalgameStoryModel):
    visible: bool = True
    position: Literal["topLeft", "topRight", "bottomLeft", "bottomRight"] = "bottomRight"
    style: Literal["descriptive", "compact"] = "descriptive"
    show_in_export: bool = Field(default=True, alias="showInExport")

from typing import Literal

from pydantic import Field, model_validator

from studio.apps.presentation_workshop.schemas.values import Color, Identifier, SlideModel


class PresentationPaint(SlideModel):
    type: Literal["solid", "linear", "radial", "image"] = "solid"
    color: Color = "#FFFFFF"
    end_color: Color = "#5474E5"
    angle: float = Field(default=90, ge=0, le=360)
    asset_id: Identifier | None = None
    fit: Literal["cover", "contain", "repeat"] = "cover"

    @model_validator(mode="after")
    def image_reference(self):
        if (self.type == "image") != (self.asset_id is not None):
            raise ValueError("图片填充必须且只能引用图片素材")
        return self


class PresentationShadow(SlideModel):
    color: Color = "#000000"
    x: float = Field(default=4, ge=-100, le=100)
    y: float = Field(default=4, ge=-100, le=100)
    blur: float = Field(default=8, ge=0, le=100)
    opacity: float = Field(default=0.25, ge=0, le=1)


class PresentationTextLayout(SlideModel):
    vertical: bool = False
    align: Literal["top", "middle", "bottom"] = "top"
    padding: float = Field(default=8, ge=0, le=100)
    letter_spacing: float = Field(default=0, ge=-10, le=100)
    auto_fit: bool = False


class PresentationImageEffects(SlideModel):
    brightness: float = Field(default=1, ge=0, le=3)
    contrast: float = Field(default=1, ge=0, le=3)
    saturation: float = Field(default=1, ge=0, le=3)
    grayscale: float = Field(default=0, ge=0, le=1)
    blur: float = Field(default=0, ge=0, le=30)
    tint: Color | None = None
    crop_shape: Literal["rect", "ellipse", "triangle", "diamond"] = "rect"

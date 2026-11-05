from typing import Literal

from pydantic import Field

from studio.apps.presentation_workshop.schemas.values import Identifier, SlideModel


class PresentationAnimation(SlideModel):
    id: Identifier
    element_id: Identifier
    type: Literal["in", "out", "emphasis"] = "in"
    effect: Literal[
        "fade",
        "slide",
        "zoom",
        "rotate",
        "bounce",
        "flip",
        "back",
        "lightSpeed",
        "pulse",
        "shake",
        "swing",
        "tada",
        "wobble",
        "heartBeat",
    ] = "fade"
    direction: Literal["none", "left", "right", "top", "bottom"] = "none"
    trigger: Literal["click", "with_previous", "after_previous"] = "click"
    duration: int = Field(default=800, ge=50, le=10000)
    delay: int = Field(default=0, ge=0, le=30000)


class PresentationTransition(SlideModel):
    effect: Literal[
        "none",
        "fade",
        "slideX",
        "slideY",
        "slideX3D",
        "slideY3D",
        "rotate",
        "scaleX",
        "scaleY",
        "scale",
        "scaleReverse",
        "random",
    ] = "none"
    duration: int = Field(default=600, ge=50, le=10000)
    advance_after: float | None = Field(default=None, ge=1, le=3600)

from pydantic import Field

from app.apps.presentation_workshop.schemas.values import SlideModel


class PresentationPathPoint(SlideModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class PresentationPath(SlideModel):
    points: list[PresentationPathPoint] = Field(min_length=2, max_length=512)
    closed: bool = False
    smooth: bool = False

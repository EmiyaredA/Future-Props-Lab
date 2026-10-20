from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, model_validator

from app.apps.presentation_workshop.schemas.values import Identifier, SlideModel


class PresentationLink(SlideModel):
    type: Literal["web", "slide"]
    target: str = Field(min_length=1, max_length=2048)

    @model_validator(mode="after")
    def valid_target(self):
        if self.type == "web":
            url = urlsplit(self.target)
            if url.scheme not in {"http", "https"} or not url.netloc:
                raise ValueError("网页链接只支持完整的 HTTP/HTTPS 地址")
        elif len(self.target) > 64:
            raise ValueError("页面链接目标无效")
        return self


class PresentationReply(SlideModel):
    id: Identifier
    text: str = Field(min_length=1, max_length=20000)


class PresentationAnnotation(PresentationReply):
    element_id: Identifier | None = None
    replies: list[PresentationReply] = Field(default_factory=list, max_length=100)
    resolved: bool = False

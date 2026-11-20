"""Small, durable image references; image bytes never enter conversation events."""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_GENERATED_IMAGE_BYTES = 50 * 1024 * 1024
MAX_GENERATED_IMAGE_PIXELS = 40_000_000
GENERATED_IMAGE_NAME = r"^codex-[a-f0-9-]{36}-[a-f0-9]{20}\.(png|jpg|webp)$"


class GeneratedImage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["outputs"] = "outputs"
    name: str = Field(pattern=GENERATED_IMAGE_NAME, max_length=100)
    bytes: int = Field(gt=0, le=MAX_GENERATED_IMAGE_BYTES)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    mime_type: Literal["image/png", "image/jpeg", "image/webp"]
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class ImageGenerationEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str = Field(min_length=1, max_length=200)
    status: Literal["started", "completed", "failed"]
    image: GeneratedImage | None = None
    message: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def completed_image(self) -> Self:
        if (self.status == "completed") != (self.image is not None):
            raise ValueError("只有保存完成的图片事件可以包含文件引用")
        return self


def image_reference(image: dict) -> dict:
    return {
        "id": "file:outputs:" + image["name"],
        "application": "amadeus",
        "name": image["name"],
        "value": image["name"],
        "source": "outputs",
    }

from pydantic import BaseModel, ConfigDict, Field


class ImageCropIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: int = Field(ge=0, le=32768)
    y: int = Field(ge=0, le=32768)
    width: int = Field(ge=1, le=32768)
    height: int = Field(ge=1, le=32768)

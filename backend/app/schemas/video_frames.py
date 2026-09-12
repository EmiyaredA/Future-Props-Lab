from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class VideoFramesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    positions_ms: list[Annotated[int, Field(ge=0, le=86400000)]] = Field(
        min_length=1, max_length=25
    )
    max_width: int = Field(default=1280, ge=64, le=1920)
    output: Literal["zip", "grid"] = "zip"

    @model_validator(mode="after")
    def valid_grid(self):
        if self.output == "grid" and len(self.positions_ms) not in {4, 9}:
            raise ValueError("宫格输出需要 4 或 9 帧")
        return self

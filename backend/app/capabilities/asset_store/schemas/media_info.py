from typing import Literal

from pydantic import BaseModel


class VideoMediaInfoOut(BaseModel):
    container: str | None = None
    codec: str | None = None
    pixel_format: str | None = None
    alpha_channel: Literal["present", "absent", "unknown"] = "unknown"

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
Identifier = Annotated[str, Field(min_length=1, max_length=64)]


class SlideModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

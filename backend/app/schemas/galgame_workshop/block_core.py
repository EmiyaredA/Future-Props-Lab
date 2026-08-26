from pydantic import Field

from app.schemas.galgame_workshop.base_core import STABLE_ID_PATTERN, GalgameStoryModel


class GalgameStoryBlockBase(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)

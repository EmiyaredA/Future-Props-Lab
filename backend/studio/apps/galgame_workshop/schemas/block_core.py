from pydantic import Field

from studio.apps.galgame_workshop.schemas.base_core import STABLE_ID_PATTERN, GalgameStoryModel


class GalgameStoryBlockBase(GalgameStoryModel):
    id: str = Field(pattern=STABLE_ID_PATTERN)

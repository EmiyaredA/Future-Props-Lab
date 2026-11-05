"""Fixed Amadeus Mac worker operation and conversation scope."""

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

FINDER = "amadeus.conversation.reveal"
OPEN_PATH = "/v1/amadeus/conversations/{conversation_id}/files/open-folder"


class FinderScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    conversation_id: UUID

    @property
    def path(self):
        return OPEN_PATH.format(conversation_id=self.conversation_id)


class AmadeusPoll(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wait_seconds: Annotated[float, Field(ge=0, le=4)] = 1
    sandbox_available: bool

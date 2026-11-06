"""Purpose of a password-verified cloud control grant."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

CloudUnlockPurpose = Literal["agent", "desktop"]


class CloudUnlockRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    purpose: CloudUnlockPurpose

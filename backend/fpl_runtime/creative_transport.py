"""Private, bounded source context for Creative installation decisions."""

import base64
import binascii
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .creative_integrations import CreativeInstallBatch
from .creative_source_evidence import MAX_BODY

CREATIVE_SOCKET_DIR = "/run/fpl-bridge"


class CreativeAttestedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assertion: str = Field(min_length=1, max_length=8192, repr=False)
    evidence: str = Field(min_length=1, max_length=8192, repr=False)
    body_base64: str = Field(min_length=1, max_length=((MAX_BODY + 2) // 3) * 4, repr=False)

    @field_validator("body_base64")
    @classmethod
    def valid_body(cls, value):
        try:
            raw = base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError("invalid Creative request body") from None
        if not 0 < len(raw) <= MAX_BODY:
            raise ValueError("invalid Creative request body")
        return value

    def body(self):
        return base64.b64decode(self.body_base64, validate=True)


class CreativeDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["install", "receipt", "cancel"]
    source: CreativeAttestedRequest
    batch: CreativeInstallBatch

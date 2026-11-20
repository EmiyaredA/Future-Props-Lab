"""Private worker instruction delivery and receipt shapes."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class InstructionClaim(BaseModel):
    request_id: str
    text: str
    text_sha256: str


class InstructionReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(max_length=64)
    text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    status: Literal["accepted", "rejected", "unknown"]

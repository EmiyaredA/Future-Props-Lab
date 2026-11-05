"""Public factor enrollment and verification payloads; no credential storage types."""

from pydantic import BaseModel, Field


class Enrollment(BaseModel):
    secret: str


class VerificationCode(BaseModel):
    code: str = Field(pattern=r"^[0-9]{6}$")
    desktop: bool = False

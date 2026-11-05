"""Public account project certification values."""

from pydantic import BaseModel, Field


class CertificationIn(BaseModel):
    is_official: bool
    expected_revision: int = Field(ge=0)


class CertificationOut(BaseModel):
    id: str
    is_official: bool
    revision: int

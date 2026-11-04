"""Path-free source values crossing the Creative and Integrations boundary."""

import hashlib
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict


@dataclass(frozen=True)
class CreativeSource:
    title: str
    summary: str
    manifest: dict
    skill_archive: bytes | None = None
    skill_sha256: str = ""

    def verified_skill(self) -> bytes | None:
        if self.skill_archive is None:
            if self.skill_sha256:
                raise ValueError("Skill 来源摘要无效")
            return None
        if hashlib.sha256(self.skill_archive).hexdigest() != self.skill_sha256:
            raise ValueError("Skill 来源摘要不匹配")
        return self.skill_archive


class CreativeSourcePayload(BaseModel):
    model_config = ConfigDict(
        extra="forbid", from_attributes=True, ser_json_bytes="base64", val_json_bytes="base64"
    )
    title: str
    summary: str
    manifest: dict
    skill_archive: bytes | None
    skill_sha256: str

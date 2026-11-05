"""Exact request paths and archive metadata for owned Amadeus Skill pins."""

import base64
import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from .amadeus_native import RUN_SOURCE

ID = r"[A-Za-z0-9_-]{1,128}"
VERSION = r"v[1-9][0-9]{0,22}"
SKILL_SOURCE = "/_internal/v1/amadeus-skill-pins"
SKILL_FILE_ROUTE = (
    "/v1/amadeus/conversations/{conversation_id}/skills/{skill_id}/{version}/files/{relative_path}"
)
SOURCE = re.compile(rf"/v1/amadeus/conversations/{ID}/skills/(?P<skill>{ID})/load")
TARGET = re.compile(rf"{SKILL_SOURCE}/(?P<skill>{ID})/(?P<kind>metadata|archive)")
PURPOSE = "amadeus.skill.pin"
HEADER = "X-Fpl-Skill-Pin"


def pin_target(method, path):
    return TARGET.fullmatch(path) if method == "GET" else None


def skill_pin_grant(grant):
    if (
        grant.caller != "amadeus"
        or grant.purpose != PURPOSE
        or grant.source_method != "POST"
        or grant.target_service != "integrations"
    ):
        return False
    source = SOURCE.fullmatch(grant.source_path)
    target = pin_target(grant.target_method, grant.target_path)
    return bool(
        target
        and (
            (source and source["skill"] == target["skill"])
            or RUN_SOURCE.fullmatch(grant.source_path)
        )
    )


class SkillPin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, Field(min_length=1, max_length=120)]
    version: Annotated[str, Field(pattern=rf"^{VERSION}$")]
    file_count: Annotated[int, Field(strict=True, gt=0)]
    expanded_bytes: Annotated[int, Field(strict=True, gt=0)]
    archive_bytes: Annotated[int, Field(strict=True, gt=0)]
    archive_sha256: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]

    def header(self):
        return base64.urlsafe_b64encode(self.model_dump_json().encode()).decode("ascii")

    @classmethod
    def from_header(cls, value):
        if not 1 <= len(value) <= 4096:
            raise ValueError("Skill 文件描述无效")
        return cls.model_validate_json(base64.b64decode(value, altchars=b"-_", validate=True))

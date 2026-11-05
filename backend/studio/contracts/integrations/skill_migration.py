"""Canonical file manifest and replay receipt for a frozen Skill version."""

import hashlib
from uuid import uuid5

from pydantic import BaseModel, ConfigDict, Field

from studio.contracts.management.migration_batches import BatchReceipt

PREFIX = "/v1/migration/integrations/skill-originals"
DATASET = "integrations.skill-originals"
VERSION = r"^v[1-9][0-9]{0,22}$"
DIGEST = r"^[a-f0-9]{64}$"


class SkillFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(min_length=1, max_length=4096)
    size: int = Field(ge=0, strict=True)
    sha256: str = Field(pattern=DIGEST)


def file_receipt(plan, owner, skill, version, file):
    return BatchReceipt(
        run_id=plan.run_id,
        dataset=DATASET,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{DATASET}/{owner}/{skill}/{version}/{file.path}"),
        sha256=hashlib.sha256(file.model_dump_json().encode()).hexdigest(),
        record_count=1,
    )

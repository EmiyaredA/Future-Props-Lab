"""Scope a single editor upload to a published article and its source account."""

import hashlib
import re

from pydantic import BaseModel, ConfigDict, Field

from studio.contracts.thought_workshop.thought_archives import ArchiveBatchKey, BatchId, Fingerprint

PREFIX = "/_internal/v1/thought-community-uploads"
PURPOSE = "thought.community.upload"
ID = r"[A-Za-z0-9_-]{1,128}"


def public_path(publication, note):
    return f"/v1/thought-workshop/community/publications/{publication}/notes/{note}/uploads"


def upload_target(method, path):
    if method != "POST":
        return None
    return re.fullmatch(PREFIX + rf"/({ID})/({ID})/([a-f0-9]{{32}})/([a-f0-9]{{64}})", path)


def upload_grant(grant):
    if (
        grant.caller != "thought"
        or grant.purpose != PURPOSE
        or grant.source_method != "POST"
        or grant.target_service != "assets"
    ):
        return False
    target = upload_target(grant.target_method, grant.target_path)
    return bool(target and grant.source_path == public_path(target[1], target[2]))


class CommunityUploadScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    actor_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,36}$")
    owner_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,36}$")
    publication_id: str = Field(pattern=f"^{ID}$")
    note_id: str = Field(pattern=f"^{ID}$")
    publication_revision: int = Field(ge=0, strict=True)
    article_revision: int = Field(ge=0, strict=True)
    batch_id: BatchId
    descriptor_sha256: Fingerprint

    @property
    def target(self):
        return (
            f"{PREFIX}/{self.publication_id}/{self.note_id}/"
            f"{self.batch_id}/{self.descriptor_sha256}"
        )

    @property
    def key(self):
        return ArchiveBatchKey(
            batch_id=self.batch_id,
            source_sha256=hashlib.sha256(
                b"thought-community-upload-v1\0" + self.model_dump_json().encode()
            ).hexdigest(),
        )

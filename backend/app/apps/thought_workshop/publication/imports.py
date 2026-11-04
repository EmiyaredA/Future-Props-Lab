"""Explicit administrator import of the packaged migration source, never a reader."""

import io
import json
import zipfile

from pydantic import BaseModel, ConfigDict, Field

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.notes import Notes
from app.apps.thought_workshop.portability import import_backup
from app.apps.thought_workshop.schemas.document import validate_document
from app.apps.thought_workshop.schemas.workshop import ThoughtImportOut
from app.runtime.config import get_settings

from .access import current_actor
from .models import OfficialImportReceipt, OfficialSource
from .mutations import begin_write
from .official_source import require_admin, source


class SeedImportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    package_version: str = Field(min_length=64, max_length=64)


class PackageFile:
    filename = "official-notes.zip"
    content_type = "application/zip"

    def __init__(self, data):
        self.buffer = io.BytesIO(data)

    async def read(self, size=-1):
        return self.buffer.read(size)

    async def close(self):
        self.buffer.close()


async def import_source(session, principal, body):
    principal = await current_actor(session, principal)
    require_admin(principal)
    # Completed requests replay even after an application upgrade changes the seed.
    key = (principal.owner_user_id, principal.user_id, body.request_id)
    prior = await session.get(OfficialImportReceipt, key)
    if prior:
        if prior.package_version != body.package_version:
            raise ThoughtError("导入请求已用于其他版本", 409, "import_conflict")
        return ThoughtImportOut.model_validate(prior.result)
    seed, version = source()
    if version != body.package_version:
        raise ThoughtError("导入包已更新，请重新预览", 409, "import_conflict")
    for note in seed["archive"]["notes"]:
        validate_document(note["document"])
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(seed["archive"], ensure_ascii=False))

    async def before_write(s):
        await begin_write(s)
        require_admin(await current_actor(s, principal))
        current = await s.get(OfficialImportReceipt, key)
        if current:
            if current.package_version != version:
                raise ThoughtError("导入请求已用于其他版本", 409, "import_conflict")
            return ThoughtImportOut.model_validate(current.result)
        return None

    async def before_commit(s, notes, _projects, result):
        s.add_all(
            OfficialSource(
                note_id=notes[o["note_id"]],
                owner_user_id=principal.owner_user_id,
                library_key=o["library_key"],
                document_key=o["document_key"],
            )
            for o in seed["origins"]
        )
        s.add(
            OfficialImportReceipt(
                owner_user_id=principal.owner_user_id,
                user_id=principal.user_id,
                request_id=body.request_id,
                package_version=version,
                result=result.model_dump(mode="json"),
            )
        )

    return await import_backup(
        Notes(session, principal.owner_user_id, principal.user_id),
        get_settings(),
        PackageFile(buffer.getvalue()),
        before_write=before_write,
        before_commit=before_commit,
    )

"""Transfer the original, digest-bound profile files through Identity maintenance."""

import asyncio
import hashlib
from uuid import UUID

from fastapi import HTTPException, Request, Response
from pydantic import BaseModel

from app.console.governance.profile import AVATAR_MAX_BYTES
from studio.runtime.http.migration_admission import MigrationAdmission

from .avatar_files import avatar_path, inventory_files, lookup, read_file, store_file
from .credential_migration import Digest

AVATAR_PATH = "/v1/migration/identity/avatars"
DIGEST_HEADER = "X-Fpl-Migration-SHA256"


class AvatarReceipt(BaseModel):
    owner_id: UUID
    sha256: Digest
    byte_size: int


def mount_avatars(app, plan, sessions, root, *, source=None):
    admission = MigrationAdmission(plan)

    def source_check():
        if source is not None:
            try:
                source.check()
            except (OSError, ValueError):
                raise HTTPException(409, {"code": "migration_source_changed"}) from None

    @app.get(f"{AVATAR_PATH}/inventory")
    async def inventory():
        source_check()
        count = await inventory_files(sessions, root, require_all=source is not None)
        source_check()
        return {"record_count": count}

    @app.get(f"{AVATAR_PATH}/{{owner_id}}")
    async def read_avatar(owner_id: UUID):
        admission.check_owner(owner_id)
        source_check()
        filename, mime, expected = await lookup(sessions, owner_id)
        if filename is None:
            return Response(status_code=204)
        try:
            path = avatar_path(root, owner_id, filename)
            data = await asyncio.to_thread(read_file, path, expected)
        except (ValueError, OSError):
            raise HTTPException(409, {"code": "migration_avatar_file_invalid"}) from None
        source_check()
        return Response(data, media_type=mime, headers={DIGEST_HEADER: expected})

    if source is None:

        @app.put(f"{AVATAR_PATH}/{{owner_id}}", response_model=AvatarReceipt)
        async def import_avatar(owner_id: UUID, request: Request):
            admission.check_owner(owner_id)
            filename, mime, expected = await lookup(sessions, owner_id)
            if filename is None:
                raise HTTPException(409, {"code": "migration_avatar_metadata_missing"})
            data = await request.body()
            if (
                not 0 < len(data) <= AVATAR_MAX_BYTES
                or request.headers.get("Content-Type") != mime
                or request.headers.get(DIGEST_HEADER) != expected
                or hashlib.sha256(data).hexdigest() != expected
            ):
                raise HTTPException(422, {"code": "migration_digest_mismatch"})
            try:
                path = avatar_path(root, owner_id, filename)
                await asyncio.to_thread(store_file, path, expected, data)
            except (ValueError, OSError):
                raise HTTPException(409, {"code": "migration_avatar_file_conflict"}) from None
            return AvatarReceipt(owner_id=owner_id, sha256=expected, byte_size=len(data))

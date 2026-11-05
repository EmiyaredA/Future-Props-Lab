"""Private, owner-bound streaming transport for legacy Interview material files."""

import asyncio
from uuid import UUID

from fastapi import Request
from fastapi.responses import FileResponse

from studio.apps.interview_assistant.storage.migration_materials import PREFIX, Materials
from studio.apps.interview_assistant.storage.migration_records import Material
from studio.contracts.management.migration_batches import BatchReceipt
from studio.contracts.management.project_history import Identifier
from studio.runtime.database.project_history_migration import blocked
from studio.runtime.http.migration_admission import MigrationAdmission

OWNER = PREFIX + "/{owner}"
FILE = OWNER + "/{room}/{material}"


def mount_materials(app, plan, sessions, *, root, source=None):
    materials = Materials(plan, sessions, root)
    admission = MigrationAdmission(plan)

    def check(owner=None):
        if owner is not None:
            admission.check_owner(owner)
        if source is not None:
            try:
                source.check()
            except (OSError, ValueError):
                raise blocked("migration_source_changed") from None

    @app.get(PREFIX)
    async def accounts():
        check()
        try:
            await asyncio.to_thread(materials.check_owners)
        except (ValueError, OSError):
            raise blocked("migration_interview_material_inventory_conflict") from None
        check()
        return {"verified": True}

    @app.get(OWNER + "/inventory", response_model=list[Material])
    async def inventory(owner: UUID, complete: bool = False):
        check(owner)
        try:
            files = await materials.manifest(
                owner,
                complete=complete or source is not None,
                require_receipts=complete and source is None,
            )
        except (ValueError, OSError):
            raise blocked("migration_interview_material_inventory_conflict") from None
        check(owner)
        return files

    @app.get(FILE)
    async def read(owner: UUID, room: Identifier, material: Identifier):
        check(owner)
        try:
            path = await materials.read(owner, room, material)
        except (ValueError, OSError):
            raise blocked("migration_interview_material_unavailable") from None
        check(owner)
        return FileResponse(path, media_type="application/octet-stream")

    if source is None:

        @app.put(FILE, response_model=BatchReceipt)
        async def save(request: Request, owner: UUID, room: Identifier, material: Identifier):
            check(owner)
            try:
                return await materials.save(request.stream(), owner, room, material)
            except (ValueError, OSError):
                raise blocked("migration_interview_material_unavailable") from None

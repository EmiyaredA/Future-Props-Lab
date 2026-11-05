"""Private HTTP adapter for Integrations-owned Skill originals."""

from asyncio import to_thread
from typing import Annotated
from uuid import UUID

from fastapi import Path as RoutePath
from fastapi import Query, Request
from fastapi.responses import FileResponse

from studio.apps.integrations.storage.migration_skill_originals import (
    SkillOriginalConflict,
    SkillOriginals,
)
from studio.contracts.asset_library.descriptions import ID
from studio.contracts.integrations.skill_migration import DIGEST, PREFIX, VERSION, SkillFile
from studio.contracts.management.migration_batches import BatchReceipt
from studio.runtime.database.project_history_migration import blocked
from studio.runtime.http.migration_admission import MigrationAdmission

SkillParam = Annotated[str, RoutePath(pattern=f"^{ID}$")]
VersionParam = Annotated[str, RoutePath(pattern=VERSION)]
MemberParam = Annotated[str, Query(min_length=1, max_length=4096)]
DigestParam = Annotated[str, Query(pattern=DIGEST)]
SizeParam = Annotated[int, Query(ge=0)]
OWNER_ROUTE = PREFIX + "/{owner}"
VERSION_ROUTE = OWNER_ROUTE + "/{skill}/{version}"


def problem(error, fallback):
    return blocked(error.code if isinstance(error, SkillOriginalConflict) else fallback)


def mount_skill_originals(app, plan, sessions, *, root, source=None):
    originals = SkillOriginals(root, sessions, plan)
    admission = MigrationAdmission(plan)

    def verify_source():
        if source is not None:
            try:
                source.check()
            except (ValueError, OSError):
                raise blocked("migration_source_changed") from None

    @app.get(PREFIX)
    async def owners():
        verify_source()
        try:
            await to_thread(originals.verify_account_roots)
        except (ValueError, OSError) as error:
            raise problem(error, "migration_skill_file_inventory_conflict") from None
        verify_source()
        return {"verified": True}

    @app.get(OWNER_ROUTE + "/inventory")
    async def owner_inventory(owner: UUID):
        admission.check_owner(owner)
        verify_source()
        try:
            await originals.verify_owner(owner)
        except (ValueError, OSError) as error:
            raise problem(error, "migration_skill_file_inventory_conflict") from None
        verify_source()
        return {"verified": True}

    @app.get(VERSION_ROUTE + "/inventory", response_model=list[SkillFile])
    async def version_inventory(
        owner: UUID, skill: SkillParam, version: VersionParam, complete: bool = False
    ):
        admission.check_owner(owner)
        verify_source()
        try:
            result = await originals.manifest(
                owner,
                skill,
                version,
                complete=complete or source is not None,
                require_receipts=complete and source is None,
            )
        except (ValueError, OSError) as error:
            raise problem(error, "migration_skill_file_inventory_conflict") from None
        verify_source()
        return result

    @app.get(VERSION_ROUTE + "/file")
    async def read_file(
        owner: UUID,
        skill: SkillParam,
        version: VersionParam,
        path: MemberParam,
        size: SizeParam,
        sha256: DigestParam,
    ):
        admission.check_owner(owner)
        verify_source()
        try:
            result = await originals.read(
                owner, skill, version, SkillFile(path=path, size=size, sha256=sha256)
            )
        except (ValueError, OSError) as error:
            raise problem(error, "migration_skill_file_bytes_changed") from None
        verify_source()
        return FileResponse(result, media_type="application/octet-stream")

    if source is None:

        @app.put(VERSION_ROUTE + "/file", response_model=BatchReceipt)
        async def put_file(
            request: Request,
            owner: UUID,
            skill: SkillParam,
            version: VersionParam,
            path: MemberParam,
            size: SizeParam,
            sha256: DigestParam,
        ):
            admission.check_owner(owner)
            try:
                return await originals.save(
                    request.stream(),
                    owner,
                    skill,
                    version,
                    SkillFile(path=path, size=size, sha256=sha256),
                )
            except (ValueError, OSError) as error:
                raise problem(error, "migration_skill_file_bytes_changed") from None

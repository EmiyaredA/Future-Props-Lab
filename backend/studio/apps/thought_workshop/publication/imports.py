"""Explicit administrator import of the packaged migration source, never a reader."""

from pydantic import BaseModel, ConfigDict, Field

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.notes import Notes
from studio.apps.thought_workshop.publication.access import current_actor
from studio.apps.thought_workshop.publication.models import OfficialImportReceipt, OfficialSource
from studio.apps.thought_workshop.publication.mutations import begin_write
from studio.apps.thought_workshop.publication.official_source import require_admin, source
from studio.apps.thought_workshop.schemas.workshop import ThoughtImportOut
from studio.apps.thought_workshop.website.archive_import import (
    allocate_ids,
    archive_references,
    persist_archive,
    validate_payload,
)


class SeedImportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    package_version: str = Field(min_length=64, max_length=64)


async def import_source(session, principal, body, *, projections=None):
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
    try:
        payload, parsed = validate_payload(seed["archive"])
    except (ValueError, TypeError, KeyError) as exc:
        raise ThoughtError("官方文档包内容无效") from exc
    if payload.get("assets"):
        raise ThoughtError("官方文档包含未提供的附件")
    ids = allocate_ids(payload)
    commit_started = False
    try:
        if projections is not None:
            await session.rollback()
            await projections.prepare(archive_references(payload, parsed, ids, {}))
            await projections.require_active()
        await begin_write(session)
        if projections is None:
            require_admin(await current_actor(session, principal))
        current = await session.get(OfficialImportReceipt, key)
        if current:
            if current.package_version != version:
                raise ThoughtError("导入请求已用于其他版本", 409, "import_conflict")
            return ThoughtImportOut.model_validate(current.result)
        result, notes, _ = await persist_archive(
            Notes(session, principal.owner_user_id, principal.user_id),
            payload,
            parsed,
            {},
            ids,
        )
        session.add_all(
            OfficialSource(
                note_id=notes[o["note_id"]],
                owner_user_id=principal.owner_user_id,
                library_key=o["library_key"],
                document_key=o["document_key"],
            )
            for o in seed["origins"]
        )
        session.add(
            OfficialImportReceipt(
                owner_user_id=principal.owner_user_id,
                user_id=principal.user_id,
                request_id=body.request_id,
                package_version=version,
                result=result.model_dump(mode="json"),
            )
        )
        if projections is not None:
            await projections.record(session)
        commit_started = True
        await session.commit()
        return result
    finally:
        if not commit_started:
            await session.rollback()
            if projections is not None:
                await projections.abort(session)

"""Explicit administrator import of the packaged migration source, never a reader."""

import hashlib
import io
import json
import zipfile
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.models import ThoughtNote
from app.apps.thought_workshop.notes import Notes
from app.apps.thought_workshop.portability import import_backup
from app.apps.thought_workshop.schemas.document import validate_document
from app.apps.thought_workshop.schemas.workshop import ThoughtImportOut
from app.runtime.config import get_settings

from .access import article, can_certify, current_actor, missing, publication
from .catalog import output
from .models import OfficialImportReceipt, OfficialSource, Publication
from .mutations import begin_write
from .schemas import PublicationOut


class SeedImportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    package_version: str = Field(min_length=64, max_length=64)


class SeedPreview(BaseModel):
    package_version: str
    library_count: int
    article_count: int
    figure_count: int
    titles: list[str]


class LegacyTarget(BaseModel):
    publication: PublicationOut
    note_id: str
    title: str
    excerpt: str


def source():
    raw = Path(__file__).with_name("seed.json").read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def require_admin(principal):
    if not can_certify(principal) or not principal.allows("content.write"):
        raise ThoughtError("只有平台管理员可以导入现有官方文档", 403, "official_forbidden")


def preview(principal):
    require_admin(principal)
    seed, version = source()
    archive = seed["archive"]

    def figures(node):
        return int(node["type"] in {"canvas", "mermaid"}) + sum(
            figures(n) for n in node.get("content", [])
        )

    return SeedPreview(
        package_version=version,
        library_count=len(archive["knowledge_bases"]),
        article_count=sum(not n["is_home"] for n in archive["notes"]),
        figure_count=sum(figures(n["document"]) for n in archive["notes"]),
        titles=[p["title"] for p in archive["knowledge_bases"]],
    )


async def receipt(session, principal, request_id):
    require_admin(principal)
    row = await session.get(
        OfficialImportReceipt, (principal.workspace_id, principal.user_id, request_id)
    )
    if not row:
        raise missing()
    return ThoughtImportOut.model_validate(row.result)


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
    key = (principal.workspace_id, principal.user_id, body.request_id)
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
                workspace_id=principal.workspace_id,
                library_key=o["library_key"],
                document_key=o["document_key"],
            )
            for o in seed["origins"]
        )
        s.add(
            OfficialImportReceipt(
                workspace_id=principal.workspace_id,
                user_id=principal.user_id,
                request_id=body.request_id,
                package_version=version,
                result=result.model_dump(mode="json"),
            )
        )

    return await import_backup(
        Notes(session, principal.workspace_id, principal.user_id),
        get_settings(),
        PackageFile(buffer.getvalue()),
        before_write=before_write,
        before_commit=before_commit,
    )


async def resolve_legacy(session, principal, library_key, document_key=""):
    # Origin mappings alone never authorize access or expose private imported titles.

    rows = (
        await session.execute(
            select(Publication.id, OfficialSource.note_id)
            .join(ThoughtNote, ThoughtNote.knowledge_base_id == Publication.knowledge_base_id)
            .join(OfficialSource, OfficialSource.note_id == ThoughtNote.id)
            .where(
                Publication.active.is_(True),
                Publication.is_official.is_(True),
                OfficialSource.library_key == library_key,
                OfficialSource.document_key == document_key,
                OfficialSource.workspace_id == Publication.workspace_id,
                ThoughtNote.workspace_id == Publication.workspace_id,
            )
        )
    ).all()
    targets = []
    for pub_id, note_id in rows:
        try:
            pub = await publication(session, pub_id)
            _, note, _ = await article(session, principal, pub, note_id)
            targets.append(
                LegacyTarget(
                    publication=await output(session, principal, pub),
                    note_id=note.id,
                    title=note.title,
                    excerpt=note.search_text[:240],
                )
            )
        except ThoughtError as error:
            if error.status != 404:
                raise
    return targets

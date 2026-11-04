"""Read-only official package metadata and authorized compatibility links."""

import hashlib
import json
from pathlib import Path

from pydantic import BaseModel
from sqlalchemy import select

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.models import ThoughtNote
from app.apps.thought_workshop.schemas.workshop import ThoughtImportOut

from .access import article, can_certify, missing, publication
from .catalog import output
from .models import OfficialImportReceipt, OfficialSource, Publication
from .schemas import PublicationOut


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
        OfficialImportReceipt, (principal.owner_user_id, principal.user_id, request_id)
    )
    if not row:
        raise missing()
    return ThoughtImportOut.model_validate(row.result)


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
                OfficialSource.owner_user_id == Publication.owner_user_id,
                ThoughtNote.owner_user_id == Publication.owner_user_id,
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

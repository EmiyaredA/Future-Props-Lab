"""Select exactly one currently published asset after checking the viewing account."""

from dataclasses import dataclass

from sqlalchemy import select

from app.apps.thought_workshop.multitable.storage import asset_ids, snapshot
from app.apps.thought_workshop.publication.access import (
    article,
    current_actor,
    missing,
    publication,
)
from app.apps.thought_workshop.publication.catalog import visible
from app.apps.thought_workshop.publication.models import CommunityUpload
from app.apps.thought_workshop.schemas.document import file_ids


@dataclass(frozen=True)
class CommunityAssetEvidence:
    viewer_id: str
    source_owner_id: str
    publication_id: str
    publication_revision: int
    asset_id: str
    note_id: str | None
    note_revision: int | None
    article_revision: int | None
    cover: bool


async def published_asset(
    session, principal, publication_id, asset_id, *, note_id=None, cover=False, allow_draft=False
):
    """Re-evaluate a browser viewer's current publication, article and body.

    This function returns only proof inputs; it does not access a file, bind the
    caller to the source account, or grant an Assets service authorization.
    Call again in a fresh transaction immediately before granting file access.
    """
    if session.info.get("owner_user_id") is not None:
        raise ValueError("社区授权必须从未绑定账号的发布目录会话开始")
    principal = await current_actor(session, principal)
    if principal.auth_kind != "session":
        raise missing()
    pub = await publication(session, publication_id)
    if cover:
        if note_id is not None or not asset_id or asset_id != pub.cover_asset_id:
            raise missing()
        rows, manager = await visible(session, principal, pub)
        if not rows and not manager:
            raise missing()
        return CommunityAssetEvidence(
            principal.user_id,
            pub.owner_user_id,
            pub.id,
            pub.revision,
            asset_id,
            None,
            None,
            None,
            True,
        )
    if note_id:
        config, note, role = await article(session, principal, pub, note_id)
        allowed = file_ids(note.document)
        if note.kind == "multitable":
            allowed |= asset_ids(await snapshot(session, note.id))
        if asset_id not in allowed and not (
            allow_draft
            and role in {"edit", "manage"}
            and await session.scalar(
                select(CommunityUpload.asset_id).where(
                    CommunityUpload.note_id == note.id,
                    CommunityUpload.asset_id == asset_id,
                    CommunityUpload.user_id == principal.user_id,
                )
            )
        ):
            raise missing()
        return CommunityAssetEvidence(
            principal.user_id,
            pub.owner_user_id,
            pub.id,
            pub.revision,
            asset_id,
            note.id,
            note.revision,
            config.revision,
            False,
        )
    rows, _manager = await visible(session, principal, pub, include_content=True)
    for note, config, role in rows:
        if not role:
            continue
        allowed = file_ids(note.document)
        if note.kind == "multitable":
            allowed |= asset_ids(await snapshot(session, note.id))
        if asset_id in allowed:
            return CommunityAssetEvidence(
                principal.user_id,
                pub.owner_user_id,
                pub.id,
                pub.revision,
                asset_id,
                note.id,
                note.revision,
                config.revision,
                False,
            )
    raise missing()

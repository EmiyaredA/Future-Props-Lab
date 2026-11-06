from sqlalchemy import and_, or_, select
from sqlalchemy.orm import load_only

from studio.apps.thought_workshop.publication.access import (
    can_certify,
    capabilities,
    effective_role,
    manages_source,
    missing,
    publication,
    source_role,
)
from studio.apps.thought_workshop.publication.models import (
    ArticleMember,
    CommunityFavorite,
    OfficialSource,
    Publication,
    PublishedArticle,
)
from studio.apps.thought_workshop.publication.schemas import (
    CommunityArticle,
    CommunityDirectory,
    PublicationOut,
)
from studio.apps.thought_workshop.schemas.workshop import ThoughtNoteSummary
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote
from studio.apps.thought_workshop.website.account_directory import author as find_author


async def visible(session, principal, pub, query="", include_content=False, *, accounts):
    manager = principal.user_id == pub.publisher_id or await manages_source(
        principal, pub.owner_user_id, accounts=accounts
    )
    original_role = await source_role(principal, pub.owner_user_id, accounts=accounts)
    statement = (
        select(ThoughtNote, PublishedArticle, ArticleMember.role)
        .join(
            PublishedArticle,
            and_(
                PublishedArticle.note_id == ThoughtNote.id,
                PublishedArticle.publication_id == pub.id,
            ),
        )
        .outerjoin(
            ArticleMember,
            and_(
                ArticleMember.publication_id == pub.id,
                ArticleMember.note_id == ThoughtNote.id,
                ArticleMember.user_id == principal.user_id,
            ),
        )
        .where(
            ThoughtNote.owner_user_id == pub.owner_user_id,
            ThoughtNote.knowledge_base_id == pub.knowledge_base_id,
            ThoughtNote.deleted_at.is_(None),
            PublishedArticle.active.is_(True),
            or_(
                PublishedArticle.visibility == "public",
                ArticleMember.role.is_not(None),
                original_role is not None or principal.user_id == pub.publisher_id,
            ),
        )
    )
    if not include_content:
        statement = statement.options(
            load_only(
                *(
                    getattr(ThoughtNote, key)
                    for key in ThoughtNoteSummary.model_fields
                    if key != "excerpt"
                ),
                ThoughtNote.search_text,
                ThoughtNote.owner_user_id,
            )
        )
    if query.strip():
        statement = statement.where(
            or_(
                ThoughtNote.title.contains(query.strip(), autoescape=True),
                ThoughtNote.search_text.contains(query.strip(), autoescape=True),
            )
        )
    rows = (await session.execute(statement.order_by(ThoughtNote.position, ThoughtNote.id))).all()
    return [
        (n, c, effective_role(pub, principal, original_role, role, c.visibility))
        for n, c, role in rows
    ], manager


async def output(session, principal, pub, rows=None, manager=None, *, accounts):
    if rows is None:
        rows, manager = await visible(session, principal, pub, accounts=accounts)
    author = await find_author(accounts, pub.publisher_id)
    favorite = await session.get(CommunityFavorite, (principal.user_id, "community/" + pub.id))
    if not favorite:
        favorite = (
            await session.scalar(
                select(CommunityFavorite)
                .join(
                    OfficialSource,
                    CommunityFavorite.resource_id == "official/" + OfficialSource.library_key,
                )
                .join(ThoughtNote, ThoughtNote.id == OfficialSource.note_id)
                .where(
                    CommunityFavorite.user_id == principal.user_id,
                    ThoughtNote.knowledge_base_id == pub.knowledge_base_id,
                    OfficialSource.owner_user_id == pub.owner_user_id,
                )
                .limit(1)
            )
            if pub.is_official
            else None
        )
    return PublicationOut(
        id=pub.id,
        title=pub.title,
        description=pub.description,
        author=(author.display_name or author.username) if author else "已注销用户",
        document_count=sum(not n.is_home for n, _, _ in rows),
        updated_at=max([pub.updated_at, *(n.updated_at for n, _, _ in rows)]),
        revision=pub.revision,
        active=pub.active,
        can_manage_library=bool(manager),
        is_official=pub.is_official,
        read_only=pub.read_only,
        editable_platform_roles=pub.editable_platform_roles or [],
        can_set_official=can_certify(principal),
        favorite=bool(favorite),
        cover_url=f"/v1/thought-workshop/community/publications/{pub.id}/cover"
        if pub.cover_asset_id
        else None,
    )


async def directory(session, principal, id, *, accounts):
    pub = await publication(session, id)
    rows, manager = await visible(session, principal, pub, accounts=accounts)
    if not rows and not manager:
        raise missing()
    ids = {n.id for n, _, _ in rows}
    docs = [
        CommunityArticle(
            **{
                key: getattr(n, key)
                for key in ThoughtNoteSummary.model_fields
                if key not in {"excerpt", "parent_id"}
            },
            excerpt=n.search_text[:240],
            parent_id=n.parent_id if n.parent_id in ids else None,
            **capabilities(role or "read"),
            permission_revision=c.revision,
        )
        for n, c, role in rows
    ]
    return CommunityDirectory(
        publication=await output(session, principal, pub, rows, manager, accounts=accounts),
        documents=docs,
    )


async def listing(
    session, principal, query, mine, favorites, offset, limit, official=None, *, accounts
):
    manager = Publication.owner_user_id == principal.user_id
    source_member = manager
    granted = (
        select(ArticleMember.user_id)
        .where(
            ArticleMember.publication_id == Publication.id,
            ArticleMember.note_id == PublishedArticle.note_id,
            ArticleMember.user_id == principal.user_id,
        )
        .correlate(Publication, PublishedArticle, OfficialSource)
        .exists()
    )
    visible_article = (
        select(ThoughtNote.id)
        .join(PublishedArticle, PublishedArticle.note_id == ThoughtNote.id)
        .where(
            PublishedArticle.publication_id == Publication.id,
            PublishedArticle.active.is_(True),
            ThoughtNote.knowledge_base_id == Publication.knowledge_base_id,
            ThoughtNote.owner_user_id == Publication.owner_user_id,
            ThoughtNote.deleted_at.is_(None),
            or_(PublishedArticle.visibility == "public", granted, manager, source_member),
        )
    )
    statement = (
        select(Publication)
        .join(
            ThoughtKnowledgeBase,
            and_(
                ThoughtKnowledgeBase.id == Publication.knowledge_base_id,
                ThoughtKnowledgeBase.owner_user_id == Publication.owner_user_id,
            ),
        )
        .where(ThoughtKnowledgeBase.deleted_at.is_(None), or_(visible_article.exists(), manager))
    )
    statement = statement.where(
        or_(Publication.active.is_(True), manager) if mine else Publication.active.is_(True)
    )
    if official is not None:
        statement = statement.where(Publication.is_official.is_(official))
    if mine:
        statement = statement.where(or_(manager, Publication.publisher_id == principal.user_id))
    if favorites:
        normal_favorite = (
            select(CommunityFavorite.user_id)
            .where(
                CommunityFavorite.user_id == principal.user_id,
                CommunityFavorite.resource_id == "community/" + Publication.id,
            )
            .exists()
        )
        legacy_favorite = (
            select(OfficialSource.note_id)
            .join(
                ThoughtNote,
                ThoughtNote.id == OfficialSource.note_id,
            )
            .join(
                CommunityFavorite,
                CommunityFavorite.resource_id == "official/" + OfficialSource.library_key,
            )
            .where(
                CommunityFavorite.user_id == principal.user_id,
                ThoughtNote.knowledge_base_id == Publication.knowledge_base_id,
                OfficialSource.owner_user_id == Publication.owner_user_id,
                Publication.is_official.is_(True),
            )
            .exists()
        )
        statement = statement.where(or_(normal_favorite, legacy_favorite))
    if query.strip():
        statement = statement.where(
            or_(
                Publication.title.contains(query.strip(), autoescape=True),
                Publication.description.contains(query.strip(), autoescape=True),
                visible_article.where(
                    or_(
                        ThoughtNote.title.contains(query.strip(), autoescape=True),
                        ThoughtNote.search_text.contains(query.strip(), autoescape=True),
                    )
                ).exists(),
            )
        )
    pubs = list(
        await session.scalars(
            statement.order_by(Publication.updated_at.desc(), Publication.id)
            .offset(offset)
            .limit(limit)
        )
    )
    result = []
    for pub in pubs:
        manager = principal.user_id == pub.publisher_id or await manages_source(
            principal, pub.owner_user_id, accounts=accounts
        )
        if mine and not (manager or pub.publisher_id == principal.user_id):
            continue
        if not pub.active and not mine:
            continue
        rows, _ = await visible(session, principal, pub, accounts=accounts)
        if not rows and not manager:
            continue
        item = await output(session, principal, pub, rows, manager, accounts=accounts)
        if favorites and not item.favorite:
            continue
        if (
            query.strip()
            and query.casefold() not in (item.title + " " + item.description).casefold()
        ):
            matched, _ = await visible(session, principal, pub, query, accounts=accounts)
            if not matched:
                continue
        result.append(item)
    return result

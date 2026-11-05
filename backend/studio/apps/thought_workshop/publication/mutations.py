from sqlalchemy import delete, select, text

from app.capabilities.identity.passwords import normalize_username
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.knowledge import KnowledgeBases
from studio.apps.thought_workshop.publication.access import (
    article,
    bind_source,
    can_certify,
    current_actor,
    members,
    missing,
    publication,
    require_source_manager,
)
from studio.apps.thought_workshop.publication.catalog import output
from studio.apps.thought_workshop.publication.models import (
    ArticleMember,
    Publication,
    PublishedArticle,
)
from studio.apps.thought_workshop.publication.schemas import ArticleConfig, PublicationConfig
from studio.apps.thought_workshop.storage.models import ThoughtNote
from studio.apps.thought_workshop.website.account_directory import profiles
from studio.runtime.database.ownership import bind_owner
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now


async def begin_write(session):
    # Serializes permission checks with revocations and source CAS writes on SQLite.
    await session.rollback()
    await session.execute(text("BEGIN IMMEDIATE"))


async def config(session, principal, library_id, owner_user_id=None):
    owner_user_id = owner_user_id or principal.owner_user_id
    await require_source_manager(session, principal, owner_user_id)
    await KnowledgeBases(session, owner_user_id).get(library_id)
    pub = await session.scalar(
        select(Publication).where(
            Publication.knowledge_base_id == library_id,
            Publication.owner_user_id == owner_user_id,
        )
    )
    if not pub:
        return PublicationConfig(
            publication=None, articles=[], can_set_official=can_certify(principal)
        )
    rows = (
        await session.execute(
            select(PublishedArticle, ThoughtNote)
            .join(ThoughtNote, ThoughtNote.id == PublishedArticle.note_id)
            .where(
                PublishedArticle.publication_id == pub.id,
                ThoughtNote.owner_user_id == pub.owner_user_id,
                ThoughtNote.deleted_at.is_(None),
            )
        )
    ).all()
    return PublicationConfig(
        publication=await output(session, principal, pub),
        can_set_official=can_certify(principal),
        articles=[
            ArticleConfig(
                note_id=n.id,
                title=n.title,
                revision=c.revision,
                visibility=c.visibility,
                active=c.active,
                members=await members(session, pub.id, n.id),
            )
            for c, n in rows
        ],
    )


async def settings(session, principal, pub_id, note_ids):
    pub = await publication(session, pub_id)
    result = []
    for id in dict.fromkeys(note_ids):
        c, n, _ = await article(session, principal, pub, id, level="manage", inactive=True)
        result.append(
            ArticleConfig(
                note_id=n.id,
                title=n.title,
                revision=c.revision,
                visibility=c.visibility,
                active=c.active,
                members=await members(session, pub_id, id),
            )
        )
    return result


async def resolve_member_settings(session, settings):
    normalized = set()
    for setting in settings:
        names = [member.username.strip().casefold() for member in setting.members]
        if len(set(names)) != len(names):
            raise ThoughtError("同一成员不能重复授权", 422, "duplicate_member")
        try:
            normalized.update(normalize_username(member.username) for member in setting.members)
        except ValueError:
            raise ThoughtError("成员账号不存在或不可用", 422, "member_not_found") from None
    users = {user.username.lower(): user for user in await profiles(session, usernames=normalized)}
    result = {}
    for setting in settings:
        members = []
        for member in setting.members:
            user = users.get(normalize_username(member.username))
            if user is None or not user.active:
                raise ThoughtError("成员账号不存在或不可用", 422, "member_not_found")
            members.append((user.id, member.role))
        result[setting.note_id] = members
    return result


async def apply_settings(session, pub, setting, users, *, new=False):
    current = await session.get(PublishedArticle, (pub.id, setting.note_id))
    if current is None:
        if not new or setting.expected_revision != 0:
            raise missing()
        current = PublishedArticle(publication_id=pub.id, note_id=setting.note_id, revision=0)
        session.add(current)
        await session.flush()
    if current.revision != setting.expected_revision:
        raise RevisionConflictError(
            setting.expected_revision,
            current.revision,
            {"note_id": setting.note_id, "revision": current.revision},
        )
    current.visibility = setting.visibility
    current.active = setting.active
    current.revision += 1
    await session.execute(
        delete(ArticleMember).where(
            ArticleMember.publication_id == pub.id, ArticleMember.note_id == setting.note_id
        )
    )
    session.add_all(
        ArticleMember(publication_id=pub.id, note_id=setting.note_id, user_id=id, role=role)
        for id, role in users
    )


async def publish(session, principal, library_id, body, owner_user_id=None, *, retained=None):
    owner_user_id = owner_user_id or principal.owner_user_id
    # Account lookup is completed before the source writer lock is acquired.
    await require_source_manager(session, principal, owner_user_id)
    await KnowledgeBases(session, owner_user_id).get(library_id)
    member_users = await resolve_member_settings(session, body.articles)
    await begin_write(session)
    principal = await current_actor(session, principal)
    await require_source_manager(session, principal, owner_user_id)
    source = await KnowledgeBases(session, owner_user_id).get(library_id)
    pub = await session.scalar(
        select(Publication).where(
            Publication.knowledge_base_id == library_id,
            Publication.owner_user_id == owner_user_id,
        )
    )
    if retained is not None:
        retained.verify(source, pub)
    if pub:
        # Older clients omit new flags; preserve the current configuration on updates.
        body = body.model_copy(
            update={
                key: getattr(pub, key)
                for key in ("is_official", "read_only", "editable_platform_roles")
                if key not in body.model_fields_set
            }
        )
    if not can_certify(principal):
        if body.is_official != bool(pub and pub.is_official):
            raise ThoughtError("只有平台管理员可以设置官方标记", 403, "official_forbidden")
        if set(body.editable_platform_roles) != set(pub.editable_platform_roles if pub else []):
            raise ThoughtError("只有平台管理员可以设置角色编辑授权", 403, "role_grant_forbidden")
    if pub is None:
        bind_owner(session, owner_user_id)
        if body.expected_revision != 0:
            raise ThoughtError("发布配置版本已变化", 409, "revision_conflict")
        pub = Publication(
            id=retained.publication_id if retained is not None else new_id(),
            owner_user_id=owner_user_id,
            knowledge_base_id=library_id,
            publisher_id=principal.user_id,
            revision=0,
        )
        session.add(pub)
    elif pub.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision,
            pub.revision,
            (await output(session, principal, pub)).model_dump(mode="json"),
        )
    if len({a.note_id for a in body.articles}) != len(body.articles):
        raise ThoughtError("文章不能重复", 422, "duplicate_article")
    pub.is_official = body.is_official
    pub.read_only = body.read_only
    pub.editable_platform_roles = sorted(set(body.editable_platform_roles))
    pub.title = body.title.strip() or source.title
    pub.description = body.description
    pub.active = body.active
    pub.cover_asset_id = source.cover_asset_id
    pub.revision += 1
    pub.updated_at = utc_now()
    bind_source(session, pub)
    await session.flush()
    for setting in body.articles:
        note = await session.scalar(
            select(ThoughtNote).where(
                ThoughtNote.id == setting.note_id,
                ThoughtNote.knowledge_base_id == library_id,
                ThoughtNote.owner_user_id == pub.owner_user_id,
                ThoughtNote.deleted_at.is_(None),
            )
        )
        if note is None:
            raise missing()
        await apply_settings(session, pub, setting, member_users[setting.note_id], new=True)
    if retained is not None:
        await retained.record(session, pub)
    await session.commit()
    return await config(session, principal, library_id, owner_user_id)


async def permissions(session, principal, pub_id, body):
    pub = await publication(session, pub_id)
    for setting in body.articles:
        await article(session, principal, pub, setting.note_id, level="manage", inactive=True)
    member_users = await resolve_member_settings(session, body.articles)
    await begin_write(session)
    pub = await publication(session, pub_id)
    if len({a.note_id for a in body.articles}) != len(body.articles):
        raise ThoughtError("文章不能重复", 422, "duplicate_article")
    for setting in body.articles:
        await article(session, principal, pub, setting.note_id, level="manage", inactive=True)
    bind_source(session, pub)
    for setting in body.articles:
        await apply_settings(session, pub, setting, member_users[setting.note_id])
    pub.updated_at = utc_now()
    result = []
    for setting in body.articles:
        c = await session.get(PublishedArticle, (pub_id, setting.note_id))
        n = await session.get(ThoughtNote, setting.note_id)
        result.append(
            ArticleConfig(
                note_id=n.id,
                title=n.title,
                revision=c.revision,
                visibility=c.visibility,
                active=c.active,
                members=await members(session, pub_id, n.id),
            )
        )
    await session.commit()
    return result

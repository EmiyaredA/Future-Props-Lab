from sqlalchemy import delete, select, text

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.knowledge import KnowledgeBases
from app.apps.thought_workshop.models import ThoughtNote
from app.capabilities.identity.passwords import normalize_username
from app.console.models import User
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now

from .access import (
    article,
    can_certify,
    current_actor,
    members,
    missing,
    publication,
    require_source_manager,
)
from .catalog import output
from .models import ArticleMember, Publication, PublishedArticle
from .schemas import ArticleConfig, PublicationConfig


async def begin_write(session):
    # Serializes permission checks with revocations and source CAS writes on SQLite.
    await session.rollback()
    await session.execute(text("BEGIN IMMEDIATE"))


async def config(session, principal, library_id, workspace_id=None):
    workspace_id = workspace_id or principal.workspace_id
    await require_source_manager(session, principal, workspace_id)
    await KnowledgeBases(session, workspace_id).get(library_id)
    pub = await session.scalar(
        select(Publication).where(
            Publication.knowledge_base_id == library_id,
            Publication.workspace_id == workspace_id,
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
                ThoughtNote.workspace_id == pub.workspace_id,
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


async def apply_settings(session, pub, setting, *, new=False):
    if len({m.username.strip().casefold() for m in setting.members}) != len(setting.members):
        raise ThoughtError("同一成员不能重复授权", 422, "duplicate_member")
    users = []
    for member in setting.members:
        user = await session.scalar(
            select(User).where(
                User.username_normalized == normalize_username(member.username),
                User.status == "active",
            )
        )
        if user is None:
            raise ThoughtError("成员账号不存在或不可用", 422, "member_not_found")
        users.append((user.id, member.role))
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


async def publish(session, principal, library_id, body, workspace_id=None):
    workspace_id = workspace_id or principal.workspace_id
    await begin_write(session)
    principal = await current_actor(session, principal)
    await require_source_manager(session, principal, workspace_id)
    source = await KnowledgeBases(session, workspace_id).get(library_id)
    pub = await session.scalar(
        select(Publication).where(
            Publication.knowledge_base_id == library_id,
            Publication.workspace_id == workspace_id,
        )
    )
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
        if body.expected_revision != 0:
            raise ThoughtError("发布配置版本已变化", 409, "revision_conflict")
        pub = Publication(
            workspace_id=workspace_id,
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
    await session.flush()
    for setting in body.articles:
        note = await session.scalar(
            select(ThoughtNote).where(
                ThoughtNote.id == setting.note_id,
                ThoughtNote.knowledge_base_id == library_id,
                ThoughtNote.workspace_id == pub.workspace_id,
                ThoughtNote.deleted_at.is_(None),
            )
        )
        if note is None:
            raise missing()
        await apply_settings(session, pub, setting, new=True)
    await session.commit()
    return await config(session, principal, library_id, workspace_id)


async def permissions(session, principal, pub_id, body):
    await begin_write(session)
    pub = await publication(session, pub_id)
    if len({a.note_id for a in body.articles}) != len(body.articles):
        raise ThoughtError("文章不能重复", 422, "duplicate_article")
    for setting in body.articles:
        await article(session, principal, pub, setting.note_id, level="manage", inactive=True)
    for setting in body.articles:
        await apply_settings(session, pub, setting)
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

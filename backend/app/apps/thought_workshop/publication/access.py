"""Publication-scoped access checks, independent of the active account."""

from dataclasses import replace

from sqlalchemy import select

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote
from app.console.models import User
from app.runtime.ownership import bind_owner

from .models import ArticleMember, Publication, PublishedArticle


def missing():
    return ThoughtError("内容不存在或不可访问", 404, "not_found")


async def current_actor(session, principal):
    user = await session.get(User, principal.user_id, populate_existing=True)
    if user is None or user.status != "active":
        raise missing()
    return replace(principal, platform_role=user.platform_role)


async def manages_source(session, principal, owner_user_id):
    principal = await current_actor(session, principal)
    return principal.user_id == owner_user_id


async def source_role(session, principal, owner_user_id):
    return "manage" if await manages_source(session, principal, owner_user_id) else None


async def require_source_manager(session, principal, owner_user_id):
    if not await manages_source(session, principal, owner_user_id):
        raise missing()


async def publication(session, id, *, active=True):
    row = await session.get(Publication, id)
    if row is None or (active and not row.active):
        raise missing()
    # Explicit publication ownership predicate; this registry session is unbound.
    source = await session.scalar(
        select(ThoughtKnowledgeBase).where(
            ThoughtKnowledgeBase.id == row.knowledge_base_id,
            ThoughtKnowledgeBase.owner_user_id == row.owner_user_id,
            ThoughtKnowledgeBase.deleted_at.is_(None),
        )
    )
    if source is None:
        raise missing()
    return row


def effective_role(pub, principal, original_role, member_role, visibility):
    # Platform-role editing never grants visibility or publication management.
    if principal.user_id == pub.owner_user_id:
        return "manage"
    if not original_role and not member_role and visibility != "public":
        return None
    inherited = "read" if pub.read_only and original_role == "edit" else original_role
    roles = [inherited, member_role, "read"]
    if principal.user_id == pub.owner_user_id:
        roles.append("manage")
    if principal.platform_role in (pub.editable_platform_roles or []):
        roles.append("edit")
    return max((r for r in roles if r), key={"read": 0, "edit": 1, "manage": 2}.get)


def capabilities(role):
    return {"role": role, "can_edit": role in {"edit", "manage"}, "can_manage": role == "manage"}


def can_certify(principal):
    return principal.platform_role in {"admin"}


async def article(session, principal, pub, note_id, *, level="read", inactive=False):
    principal = await current_actor(session, principal)
    config = await session.get(PublishedArticle, (pub.id, note_id))
    note = await session.scalar(
        select(ThoughtNote).where(
            ThoughtNote.id == note_id,
            ThoughtNote.knowledge_base_id == pub.knowledge_base_id,
            ThoughtNote.owner_user_id == pub.owner_user_id,
            ThoughtNote.deleted_at.is_(None),
        )
    )
    if config is None or note is None or (not inactive and not config.active):
        raise missing()
    original_role = await source_role(session, principal, pub.owner_user_id)
    member = await session.get(ArticleMember, (pub.id, note_id, principal.user_id))
    role = effective_role(
        pub, principal, original_role, member.role if member else None, config.visibility
    )
    if (
        role is None
        or {"read": 0, "edit": 1, "manage": 2}[role] < {"read": 0, "edit": 1, "manage": 2}[level]
    ):
        raise missing()
    return config, note, role


async def members(session, pub_id, note_id):
    rows = (
        await session.execute(
            select(ArticleMember, User)
            .join(User, User.id == ArticleMember.user_id)
            .where(ArticleMember.publication_id == pub_id, ArticleMember.note_id == note_id)
        )
    ).all()
    return [
        dict(username=u.username, user_id=u.id, display_name=u.display_name, role=m.role)
        for m, u in rows
    ]


def bind_source(session, pub):
    # Only called after publication/role checks. No tenant_bypass or default fallback.
    bind_owner(session, pub.owner_user_id)

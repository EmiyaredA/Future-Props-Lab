"""Publication-scoped access checks, independent of the active account."""

from sqlalchemy import select

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.publication.models import (
    ArticleMember,
    Publication,
    PublishedArticle,
)
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote
from studio.apps.thought_workshop.website.account_directory import directory, profiles
from studio.runtime.database.ownership import bind_owner


def missing():
    return ThoughtError("内容不存在或不可访问", 404, "not_found")


async def current_actor(session, principal, *, accounts=None):
    accounts = directory(session) if accounts is None else accounts
    return await accounts.current(principal)


async def manages_source(session, principal, owner_user_id, *, accounts=None):
    principal = await current_actor(session, principal, accounts=accounts)
    return principal.user_id == owner_user_id


async def source_role(session, principal, owner_user_id, *, accounts=None):
    return (
        "manage"
        if await manages_source(session, principal, owner_user_id, accounts=accounts)
        else None
    )


async def require_source_manager(session, principal, owner_user_id, *, accounts):
    if not await manages_source(session, principal, owner_user_id, accounts=accounts):
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


async def article(session, principal, pub, note_id, *, level="read", inactive=False, accounts=None):
    principal = await current_actor(session, principal, accounts=accounts)
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
    original_role = await source_role(session, principal, pub.owner_user_id, accounts=accounts)
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


async def members(session, pub_id, note_id, *, accounts):
    rows = list(
        await session.scalars(
            select(ArticleMember).where(
                ArticleMember.publication_id == pub_id,
                ArticleMember.note_id == note_id,
            )
        )
    )
    users = {
        user.id: user
        for user in await profiles(session, ids={row.user_id for row in rows}, accounts=accounts)
    }
    return [
        dict(
            username=users[row.user_id].username,
            user_id=row.user_id,
            display_name=users[row.user_id].display_name,
            role=row.role,
        )
        for row in rows
        if row.user_id in users
    ]


def bind_source(session, pub):
    # Only called after publication/role checks. No tenant_bypass or default fallback.
    bind_owner(session, pub.owner_user_id)

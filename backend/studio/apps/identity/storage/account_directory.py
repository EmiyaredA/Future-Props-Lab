"""Account directory reads return detached, explicitly public profiles."""

from sqlalchemy import or_, select

from studio.apps.identity.storage.models.accounts import User
from studio.contracts.identity.account_directory import (
    AccountProfile,
    CallerProfile,
    DirectoryResult,
)


async def lookup(session, actor, query):
    caller = await session.get(User, actor.user_id)
    rows = await session.scalars(
        select(User).where(
            or_(User.id.in_(query.ids), User.username_normalized.in_(query.usernames))
        )
    )
    return DirectoryResult(
        caller=CallerProfile(
            id=caller.id,
            username=caller.username,
            display_name=caller.display_name,
            active=True,
            platform_role=caller.platform_role,
            revision=caller.revision,
        ),
        profiles=[
            AccountProfile(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                active=user.status == "active",
            )
            for user in rows
        ],
    )


async def profile_name(session, identity):
    profile = await session.get(User, identity)
    return (profile.display_name or profile.username) if profile else None


async def template_targets(session, role, identities):
    statement = select(User.id, User.display_name, User.revision).where(
        User.platform_role == role, User.status == "active", User.must_change_password.is_(False)
    )
    if identities is not None:
        statement = statement.where(User.id.in_(set(identities)))
    rows = (await session.execute(statement.order_by(User.id).limit(1001))).all()
    return [
        {"id": row.id, "display_name": row.display_name, "revision": row.revision} for row in rows
    ]

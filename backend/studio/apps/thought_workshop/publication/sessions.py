"""Publication registry reads preserve the owning service's guarded session contracts."""

from sqlalchemy.ext.asyncio import async_sessionmaker


def source_sessions(request_session):
    return async_sessionmaker(
        request_session.bind,
        class_=type(request_session),
        sync_session_class=type(request_session.sync_session),
        expire_on_commit=False,
        info={**request_session.info, "owner_user_id": None, "allow_system_reads": True},
    )

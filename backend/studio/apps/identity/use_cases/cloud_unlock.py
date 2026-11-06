"""Cloud authorization requires a fresh password check after sign-in."""

from datetime import UTC, datetime, timedelta

from studio.contracts.identity.authentication import REAUTH_MINUTES

UNLOCK_SECONDS = 900


class CloudUnlockError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


def unlock_deadline(
    now: datetime, created_at: datetime, reauthenticated_at: datetime | None
) -> int:
    if (
        reauthenticated_at is None
        or reauthenticated_at <= created_at
        or now - reauthenticated_at > timedelta(minutes=REAUTH_MINUTES)
    ):
        raise CloudUnlockError(403, "reauthentication_required", "请重新验证管理员密码")
    return int(now.replace(tzinfo=UTC).timestamp()) + UNLOCK_SECONDS

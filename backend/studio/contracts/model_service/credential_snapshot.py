"""Immutable call attribution, independent of Identity ORM and database sessions."""

from dataclasses import asdict, dataclass

SESSION_AUTH = "session"
MANAGEMENT_API_KEY_AUTH = "management_api_key"
SESSION_FILTER = "session"


@dataclass(frozen=True)
class CredentialSnapshot:
    auth_kind: str | None = None
    api_key_id: str | None = None
    api_key_name: str | None = None
    api_key_prefix: str | None = None

    def as_kwargs(self) -> dict[str, str | None]:
        return asdict(self)


def snapshot_from_actor(actor) -> CredentialSnapshot:
    """Read only an already verified Identity actor, never caller request fields."""
    if actor.auth_kind == SESSION_AUTH:
        return CredentialSnapshot(auth_kind=SESSION_AUTH)
    if actor.auth_kind != MANAGEMENT_API_KEY_AUTH or not actor.api_key_id:
        raise ValueError("调用归因缺少有效认证上下文")
    return CredentialSnapshot(
        auth_kind=MANAGEMENT_API_KEY_AUTH,
        api_key_id=actor.api_key_id,
        api_key_name=actor.api_key_name,
        api_key_prefix=actor.api_key_prefix,
    )

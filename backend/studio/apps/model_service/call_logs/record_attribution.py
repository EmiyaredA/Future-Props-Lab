"""Map persisted attribution into an immutable public snapshot."""

from studio.contracts.model_service.credential_snapshot import CredentialSnapshot


def snapshot_from_row(row) -> CredentialSnapshot:
    return CredentialSnapshot(
        auth_kind=getattr(row, "auth_kind", None),
        api_key_id=getattr(row, "api_key_id", None),
        api_key_name=getattr(row, "api_key_name", None),
        api_key_prefix=getattr(row, "api_key_prefix", None),
    )

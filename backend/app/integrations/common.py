from __future__ import annotations

from typing import Any

from app.accounts.principal import StudioPrincipal


class IntegrationNotFoundError(Exception):
    pass


class DuplicateIntegrationError(Exception):
    pass


class IntegrationValidationError(Exception):
    pass


class IntegrationPermissionError(Exception):
    pass


def require_integration_owner(principal: StudioPrincipal) -> None:
    if not principal.allows("configuration.manage"):
        raise IntegrationPermissionError("只有 Workspace Owner 可以管理集成")


def redact_sensitive(value: str, secrets: list[str]) -> str:
    redacted = value
    for secret in secrets:
        if secret:
            redacted = redacted.replace(secret, "[REDACTED]")
    return redacted


def redact_structure(value: Any, secrets: list[str]) -> Any:
    if isinstance(value, str):
        return redact_sensitive(value, secrets)
    if isinstance(value, list):
        return [redact_structure(item, secrets) for item in value]
    if isinstance(value, dict):
        return {
            redact_sensitive(str(key), secrets): redact_structure(item, secrets)
            for key, item in value.items()
        }
    return value

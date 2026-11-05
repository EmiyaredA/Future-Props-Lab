"""Explicitly configured encryption and diagnostic redaction; no settings lookup."""

from typing import Any

from cryptography.fernet import Fernet


class SecretCipher:
    """An explicitly configured application's credential encryption boundary."""

    def __init__(self, key: str):
        self._cipher = Fernet(key.encode("ascii"))

    def encrypt(self, value: str) -> str:
        return self._cipher.encrypt(value.encode("utf-8")).decode("ascii")

    def decrypt(self, value: str) -> str:
        return self._cipher.decrypt(value.encode("ascii")).decode("utf-8")

    def hint(self, value: str) -> str:
        if not value:
            return ""
        try:
            plain = self.decrypt(value)
        except Exception:
            return ""
        return plain[-4:] if len(plain) >= 4 else "••••"


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

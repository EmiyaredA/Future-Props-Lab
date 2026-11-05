from __future__ import annotations

import hashlib
import secrets


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_session_secrets() -> tuple[str, str]:
    return secrets.token_urlsafe(32), secrets.token_urlsafe(32)


def new_management_api_key() -> str:
    return "fpm_" + secrets.token_urlsafe(32)

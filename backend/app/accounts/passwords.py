from __future__ import annotations

import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from argon2.low_level import Type

USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,64}$")
MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 128
_COMMON_PASSWORDS = {
    "1234567890",
    "adminadminadmin",
    "administrator",
    "changemechangeme",
    "passwordpassword",
    "password123456",
    "qwertyuiop",
    "welcome123456789",
    "futurepropslab",
}
PASSWORD_HASHER = PasswordHasher(
    time_cost=2,
    memory_cost=19 * 1024,
    parallelism=1,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)


class PasswordPolicyError(ValueError):
    pass


def normalize_username(value: str) -> str:
    username = value.strip()
    if not USERNAME_RE.fullmatch(username):
        raise ValueError("用户名只能包含 3–64 位 ASCII 字母、数字、点、下划线或连字符")
    return username.lower()


def validate_password(password: str) -> None:
    if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        raise PasswordPolicyError(f"密码长度必须为 {MIN_PASSWORD_LENGTH}–{MAX_PASSWORD_LENGTH} 位")
    if password.casefold() in _COMMON_PASSWORDS:
        raise PasswordPolicyError("请不要使用常见密码")


def hash_password(password: str) -> str:
    validate_password(password)
    return PASSWORD_HASHER.hash(password)


def verify_password(password_hash: str, password: str) -> tuple[bool, str | None]:
    try:
        valid = PASSWORD_HASHER.verify(password_hash, password)
    except (InvalidHashError, VerifyMismatchError):
        return False, None
    if not valid:
        return False, None
    upgraded = (
        PASSWORD_HASHER.hash(password)
        if PASSWORD_HASHER.check_needs_rehash(password_hash)
        else None
    )
    return True, upgraded


def generate_temporary_password() -> str:
    return secrets.token_urlsafe(18)

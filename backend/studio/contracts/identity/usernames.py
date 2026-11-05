"""Canonical account identifiers for public directory lookups."""

import re

USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,64}$")


def normalize_username(value: str) -> str:
    username = value.strip()
    if not USERNAME_RE.fullmatch(username):
        raise ValueError("用户名只能包含 3–64 位 ASCII 字母、数字、点、下划线或连字符")
    return username.lower()

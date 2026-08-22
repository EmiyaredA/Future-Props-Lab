from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

LOOPBACK_HOSTS = {"localhost"}


def normalize_provider_base_url(value: str) -> str:
    """Allow HTTPS providers and explicit loopback HTTP development endpoints."""
    raw = value.strip().rstrip("/")
    if not raw:
        return ""
    parsed = urlsplit(raw)
    if not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("供应商地址必须是无凭证的 HTTP(S) URL")
    hostname = parsed.hostname.lower()
    is_loopback = hostname in LOOPBACK_HOSTS
    try:
        is_loopback = is_loopback or ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        pass
    if parsed.scheme == "https" or (parsed.scheme == "http" and is_loopback):
        return raw
    raise ValueError("远程供应商地址必须使用 HTTPS；HTTP 仅允许本机回环地址")


def require_safe_provider_base_url(value: str) -> str:
    """Validate a stored provider URL again at the final outbound boundary."""
    return normalize_provider_base_url(value)

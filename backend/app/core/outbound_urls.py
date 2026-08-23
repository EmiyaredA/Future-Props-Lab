from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

LOOPBACK_HOSTS = {"localhost"}


def _is_loopback(hostname: str) -> bool:
    is_loopback = hostname in LOOPBACK_HOSTS
    try:
        return is_loopback or ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return is_loopback


def _normalize_provider_url(value: str, *, websocket: bool) -> str:
    raw = value.strip().rstrip("/")
    if not raw:
        return ""
    parsed = urlsplit(raw)
    if not parsed.hostname or parsed.username or parsed.password:
        protocol = "WebSocket" if websocket else "HTTP(S)"
        raise ValueError(f"供应商地址必须是无凭证的 {protocol} URL")
    hostname = parsed.hostname.lower()
    secure_scheme = "wss" if websocket else "https"
    loopback_scheme = "ws" if websocket else "http"
    if parsed.scheme == secure_scheme or (
        parsed.scheme == loopback_scheme and _is_loopback(hostname)
    ):
        return raw
    if websocket:
        raise ValueError("远程实时语音地址必须使用 WSS；WS 仅允许本机回环地址")
    raise ValueError("远程供应商地址必须使用 HTTPS；HTTP 仅允许本机回环地址")


def normalize_provider_base_url(value: str) -> str:
    """Allow HTTPS providers and explicit loopback HTTP development endpoints."""
    return _normalize_provider_url(value, websocket=False)


def normalize_provider_websocket_url(value: str) -> str:
    """Allow secure WebSocket providers and explicit loopback development endpoints."""
    return _normalize_provider_url(value, websocket=True)


def require_safe_provider_base_url(value: str) -> str:
    """Validate a stored provider URL again at the final outbound boundary."""
    return normalize_provider_base_url(value)


def require_safe_provider_websocket_url(value: str) -> str:
    """Validate a stored realtime provider URL at the outbound boundary."""
    return normalize_provider_websocket_url(value)


def normalize_integration_http_url(value: str) -> str:
    """Normalize an integration URL without resolving DNS during request parsing."""
    raw = value.strip()
    parsed = urlsplit(raw)
    if (
        not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
        or parsed.scheme not in {"http", "https"}
    ):
        raise ValueError("集成地址必须是无凭证、无 fragment 的 HTTP(S) URL")
    try:
        _ = parsed.port
    except ValueError as exc:
        raise ValueError("集成地址端口无效") from exc
    hostname = parsed.hostname.lower()
    if parsed.scheme == "http" and not _is_loopback(hostname):
        raise ValueError("远程集成地址必须使用 HTTPS；HTTP 仅允许本机回环地址")
    return raw


def _blocked_integration_address(address: str, *, hostname: str) -> bool:
    ip = ipaddress.ip_address(address)
    if _is_loopback(hostname):
        return not ip.is_loopback
    return any(
        (
            ip.is_private,
            ip.is_loopback,
            ip.is_link_local,
            ip.is_multicast,
            ip.is_reserved,
            ip.is_unspecified,
        )
    )


async def require_safe_integration_http_url(value: str) -> str:
    """Revalidate and resolve an integration URL at the outbound boundary."""
    normalized = normalize_integration_http_url(value)
    parsed = urlsplit(normalized)
    hostname = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        addresses = await asyncio.to_thread(
            socket.getaddrinfo,
            hostname,
            port,
            type=socket.SOCK_STREAM,
        )
    except OSError as exc:
        raise ValueError("集成地址无法解析") from exc
    resolved = {str(item[4][0]) for item in addresses}
    if not resolved or any(
        _blocked_integration_address(address, hostname=hostname) for address in resolved
    ):
        raise ValueError("集成地址解析到了不允许的网络范围")
    return normalized

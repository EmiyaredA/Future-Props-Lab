"""Resolve result URLs without treating synthetic proxy DNS as an origin."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
from urllib.parse import urlsplit

import httpx

_SYNTHETIC_NETWORKS = (
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("2001:2::/48"),
)
_DNS_ENDPOINT = "https://1.1.1.1/dns-query"
_DNS_MAX_BYTES = 64 * 1024


class GenerationMaterializationError(Exception):
    """Safe, user-displayable error raised while persisting provider output."""


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    return ip.is_global and not ip.is_multicast


def _is_synthetic(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    return any(ip.version == network.version and ip in network for network in _SYNTHETIC_NETWORKS)


async def _public_dns_addresses(
    hostname: str, *, transport: httpx.AsyncBaseTransport | None = None
) -> list[str]:
    # Bootstrap DoH at a fixed public IP without the affected system resolver.
    # TLS verification stays enabled; redirects and environment proxies are off.
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(8.0, connect=4.0),
        follow_redirects=False,
        trust_env=False,
        transport=transport,
    ) as client:

        async def query(record_type: str) -> list[str]:
            async with client.stream(
                "GET",
                _DNS_ENDPOINT,
                params={"name": hostname.encode("idna").decode("ascii"), "type": record_type},
                headers={"accept": "application/dns-json"},
            ) as response:
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > _DNS_MAX_BYTES:
                        raise ValueError("DNS response too large")
            payload = json.loads(body)
            if not isinstance(payload, dict) or not isinstance(payload.get("Answer", []), list):
                raise ValueError("Invalid DNS response")
            if payload.get("Status") != 0:
                raise ValueError("DNS query failed")
            expected_type = 1 if record_type == "A" else 28
            return [
                answer["data"]
                for answer in payload.get("Answer", [])
                if isinstance(answer, dict) and answer.get("type") == expected_type
            ]

        try:
            results = await asyncio.gather(query("A"), query("AAAA"), return_exceptions=True)
            for result in results:
                if isinstance(result, BaseException):
                    raise result
            ipv4, ipv6 = results
            addresses = list(dict.fromkeys(ipv4 + ipv6))
            if not addresses or any(not _is_public(address) for address in addresses):
                raise ValueError("DNS answer is not entirely public")
        except (httpx.HTTPError, ValueError, TypeError, KeyError, UnicodeError) as exc:
            raise GenerationMaterializationError(
                "生成结果域名解析异常，无法确认公网地址，请稍后重试"
            ) from exc
    return addresses


async def assert_public_https(
    url: str, *, dns_transport: httpx.AsyncBaseTransport | None = None
) -> tuple[str, ...]:
    """Return checked connection IPs, never just permission to resolve the host again."""
    try:
        parsed = urlsplit(url)
        hostname, port = parsed.hostname, parsed.port or 443
        if (
            parsed.scheme != "https"
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
        ):
            raise ValueError("invalid URL")
    except ValueError as exc:
        raise GenerationMaterializationError("生成结果必须使用无凭证的 HTTPS 公网地址") from exc
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        literal = None
    if literal is not None:
        if not _is_public(str(literal)):
            raise GenerationMaterializationError("生成结果地址指向非公网网络")
        return (str(literal),)

    def resolve() -> list[str]:
        return list(
            dict.fromkeys(
                item[4][0] for item in socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
            )
        )

    try:
        addresses = await asyncio.to_thread(resolve)
    except OSError as exc:
        raise GenerationMaterializationError("无法解析生成结果地址") from exc
    if not addresses:
        raise GenerationMaterializationError("生成结果地址没有可用 IP")
    if any(_is_synthetic(address) for address in addresses):
        local_name = "." not in hostname.rstrip(".") or hostname.rstrip(".").lower().endswith(
            (".local", ".localhost", ".internal", ".home.arpa")
        )
        # Never turn other private addresses or local DNS names into a DoH query.
        if local_name or any(
            not _is_public(address) and not _is_synthetic(address) for address in addresses
        ):
            raise GenerationMaterializationError("生成结果地址指向非公网网络")
        addresses = await _public_dns_addresses(hostname, transport=dns_transport)
    if any(not _is_public(address) for address in addresses):
        raise GenerationMaterializationError("生成结果地址指向非公网网络")
    return tuple(sorted(addresses, key=lambda address: ipaddress.ip_address(address).version))

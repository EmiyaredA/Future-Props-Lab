"""Bounded, anonymous public-web metadata reads; never persisted in a note."""

import asyncio
import ipaddress
import socket
import zlib
from html.parser import HTMLParser
from urllib.parse import urlsplit

import httpx

from app.apps.thought_workshop.schemas.link_preview import ThoughtLinkPreview

MAX_BYTES = 1024 * 1024
TIMEOUT = 5
_slots = asyncio.Semaphore(8)


def clean(value: str, limit: int) -> str | None:
    return " ".join(value.split())[:limit] or None


class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title: list[str] = []
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag == "meta":
            values = dict(attrs)
            name = (values.get("property") or values.get("name") or "").lower()
            content = values.get("content")
            if name in {"og:title", "og:description", "description"} and content:
                self.meta.setdefault(name, content)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)


def public_url(value: str) -> httpx.URL:
    # Reject malformed IPv6 brackets/ports before HTTPX normalizes the input.
    _ = urlsplit(value).port
    url = httpx.URL(value)
    if (
        url.scheme not in {"http", "https"}
        or not url.host
        or url.userinfo
        or len(value) > 8192
        or any(ord(char) < 32 for char in value)
    ):
        raise ValueError("Unsupported preview URL")
    return url.copy_with(fragment=None)


async def resolve_public(url: httpx.URL) -> str:
    addresses = await asyncio.to_thread(
        socket.getaddrinfo,
        url.host,
        url.port or (443 if url.scheme == "https" else 80),
        type=socket.SOCK_STREAM,
    )
    ips = {item[4][0] for item in addresses}
    if not ips or any(
        not ipaddress.ip_address(ip).is_global or ipaddress.ip_address(ip).is_multicast
        for ip in ips
    ):
        raise ValueError("Non-public preview destination")
    return sorted(ips)[0]


async def read_html(response: httpx.Response) -> str:
    # Bound decoded output before allocation, including compressed responses.
    encoding = response.headers.get("content-encoding", "identity").lower()
    if encoding not in {"identity", "gzip", "deflate"}:
        raise ValueError("Unsupported content encoding")
    decoder = (
        zlib.decompressobj(31 if encoding == "gzip" else 15) if encoding != "identity" else None
    )
    data = bytearray()
    wire_size = 0
    async for chunk in response.aiter_raw(chunk_size=16384):
        wire_size += len(chunk)
        if wire_size > MAX_BYTES:
            raise ValueError("Preview response too large")
        data.extend(decoder.decompress(chunk, MAX_BYTES + 1 - len(data)) if decoder else chunk)
        if len(data) > MAX_BYTES or (decoder and decoder.unconsumed_tail):
            raise ValueError("Decoded preview too large")
    if decoder and (not decoder.eof or decoder.unused_data):
        raise ValueError("Invalid compressed preview")
    return bytes(data).decode(response.encoding or "utf-8", errors="replace")


async def fetch_metadata(value: str) -> ThoughtLinkPreview:
    url = public_url(value)
    for hop in range(4):
        address = await resolve_public(url)
        # Connect to the checked IP, retaining the original Host and TLS identity.
        # A new client per hop deliberately prevents Cookie forwarding.
        async with httpx.AsyncClient(
            trust_env=False, follow_redirects=False, timeout=TIMEOUT
        ) as client:
            async with client.stream(
                "GET",
                url.copy_with(host=address),
                headers={
                    "Host": url.netloc.decode("ascii"),
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Encoding": "gzip, deflate",
                    "User-Agent": "FuturePropsLab-LinkPreview/1.0",
                },
                extensions={"sni_hostname": url.host},
            ) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if hop == 3 or not location:
                        raise ValueError("Too many preview redirects")
                    url = public_url(str(url.join(location)))
                    continue
                response.raise_for_status()
                mime = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                if mime not in {"text/html", "application/xhtml+xml"}:
                    raise ValueError("Not an HTML page")
                parser = MetadataParser()
                parser.feed(await read_html(response))
                title = clean(parser.meta.get("og:title", ""), 240) or clean(
                    "".join(parser.title), 240
                )
                description = clean(parser.meta.get("og:description", ""), 600) or clean(
                    parser.meta.get("description", ""), 600
                )
                return ThoughtLinkPreview(
                    url=value,
                    final_url=str(url),
                    domain=url.host,
                    title=title,
                    description=description,
                    available=bool(title or description),
                )
    raise ValueError("No preview response")


async def preview_link(value: str) -> ThoughtLinkPreview:
    fallback = ThoughtLinkPreview(url=value, final_url=value, domain="")
    try:
        fallback.domain = public_url(value).host
        # Include queueing and DNS resolution in the overall time budget.
        async with asyncio.timeout(TIMEOUT), _slots:
            return await fetch_metadata(value)
    except (
        ValueError,
        OSError,
        TimeoutError,
        httpx.HTTPError,
        httpx.InvalidURL,
        LookupError,
        zlib.error,
    ):
        return fallback

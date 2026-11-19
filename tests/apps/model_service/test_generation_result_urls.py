from __future__ import annotations

import socket

import httpx
import pytest

from studio.apps.model_service.generation import media, result_urls
from studio.apps.model_service.generation.media import GenerationMaterializationError


def system_dns(monkeypatch, *addresses):
    calls = []

    def resolve(host, port, **_kwargs):
        calls.append((host, port))
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in addresses]

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    return calls


def public_dns(request):
    assert request.url.host == "1.1.1.1"
    assert request.url.path == "/dns-query"
    assert request.url.params["name"] == "cdn.example"
    assert request.headers["accept"] == "application/dns-json"
    record_type = request.url.params["type"]
    return httpx.Response(
        200,
        json={
            "Status": 0,
            "Answer": [
                {"type": 1, "data": "93.184.216.34"}
                if record_type == "A"
                else {"type": 28, "data": "2606:4700:4700::1111"}
            ],
        },
    )


@pytest.mark.parametrize(
    "addresses",
    [("198.18.0.27", "2001:2::b"), ("198.19.0.1", "93.184.216.34")],
)
async def test_synthetic_dns_uses_verified_public_answers(monkeypatch, addresses):
    calls = system_dns(monkeypatch, *addresses)
    actual = await result_urls.assert_public_https(
        "https://cdn.example/signed.mp4?secret=never_sent_to_dns",
        dns_transport=httpx.MockTransport(public_dns),
    )
    assert actual == ("93.184.216.34", "2606:4700:4700::1111")
    assert calls == [("cdn.example", 443)]


@pytest.mark.parametrize(
    "addresses",
    [
        ("127.0.0.1",),
        ("10.0.0.1",),
        ("169.254.169.254",),
        ("::1",),
        ("fe80::1",),
        ("fc00::1",),
        ("224.0.0.1",),
        ("93.184.216.34", "192.168.1.1"),
        ("198.18.0.1", "10.0.0.1"),
    ],
)
async def test_private_mixed_and_multicast_answers_do_not_trigger_doh(monkeypatch, addresses):
    system_dns(monkeypatch, *addresses)

    def forbidden(_request):
        pytest.fail("Private DNS must not trigger external resolution")

    with pytest.raises(GenerationMaterializationError, match="非公网"):
        await result_urls.assert_public_https(
            "https://cdn.example/video.mp4", dns_transport=httpx.MockTransport(forbidden)
        )


@pytest.mark.parametrize(
    "host", ["198.18.0.1", "[2001:2::b]", "localhost", "printer.local", "db.internal"]
)
async def test_synthetic_literals_and_local_names_remain_blocked(monkeypatch, host):
    system_dns(monkeypatch, "198.18.0.27")
    with pytest.raises(GenerationMaterializationError, match="非公网"):
        await result_urls.assert_public_https(f"https://{host}/video.mp4")


@pytest.mark.parametrize(
    "payload",
    [
        {"Status": 0, "Answer": [{"type": 1, "data": "127.0.0.1"}]},
        {"Status": 0, "Answer": [{"type": 1, "data": "not-an-ip"}]},
        {"Status": 0, "Answer": []},
        {"Status": 2},
        [],
        {"Status": 0, "Answer": "invalid"},
    ],
)
async def test_doh_never_authorizes_private_empty_or_invalid_answers(monkeypatch, payload):
    system_dns(monkeypatch, "198.18.0.1")
    with pytest.raises(GenerationMaterializationError, match="无法确认公网"):
        await result_urls.assert_public_https(
            "https://cdn.example/video.mp4",
            dns_transport=httpx.MockTransport(lambda _r: httpx.Response(200, json=payload)),
        )


async def test_doh_redirect_is_not_followed(monkeypatch):
    system_dns(monkeypatch, "198.18.0.1")
    calls = []

    def redirect(request):
        calls.append(request.url.host)
        return httpx.Response(302, headers={"location": "https://127.0.0.1/internal"})

    with pytest.raises(GenerationMaterializationError, match="无法确认公网"):
        await result_urls.assert_public_https(
            "https://cdn.example/video.mp4", dns_transport=httpx.MockTransport(redirect)
        )
    assert calls == ["1.1.1.1", "1.1.1.1"]


@pytest.mark.parametrize("failure", ["timeout", "oversize", "http_error"])
async def test_doh_failure_is_bounded_and_fails_closed(monkeypatch, failure):
    system_dns(monkeypatch, "198.18.0.1")

    def fail(request):
        if failure == "timeout":
            raise httpx.ConnectTimeout("private diagnostics", request=request)
        if failure == "http_error":
            return httpx.Response(500, text="private diagnostics")
        return httpx.Response(200, content=b"x" * (64 * 1024 + 1))

    with pytest.raises(GenerationMaterializationError, match="无法确认公网") as error:
        await result_urls.assert_public_https(
            "https://cdn.example/video.mp4", dns_transport=httpx.MockTransport(fail)
        )
    assert "private diagnostics" not in str(error.value)


@pytest.mark.parametrize("url", ["http://cdn.example/a", "https://@cdn.example/a"])
async def test_non_https_and_even_empty_userinfo_are_rejected(url):
    with pytest.raises(GenerationMaterializationError, match="无凭证"):
        await result_urls.assert_public_https(url)


async def test_download_pins_ip_preserves_signed_path_host_and_tls_name(tmp_path, monkeypatch):
    calls = system_dns(monkeypatch, "93.184.216.34")
    seen = []
    url = "https://cdn.example:8443/a%2Fb/result.png?signature=a%2Fb%2Bc&x=1"

    def download(request):
        seen.append(request)
        return httpx.Response(
            200, headers={"content-type": "image/png"}, content=b"\x89PNG\r\n\x1a\ncontent"
        )

    output = tmp_path / "download"
    result = await media.download_generated_media(
        url=url, target=output, max_bytes=100, transport=httpx.MockTransport(download)
    )
    assert result[1:] == ("image", "image/png", ".png")
    assert calls == [("cdn.example", 8443)]
    assert seen[0].url.host == "93.184.216.34"
    assert seen[0].url.raw_path == httpx.URL(url).raw_path
    assert seen[0].headers["host"] == "cdn.example:8443"
    assert seen[0].extensions["sni_hostname"] == "cdn.example"
    assert output.read_bytes() == b"\x89PNG\r\n\x1a\ncontent"


async def test_redirect_is_rechecked_and_private_destination_is_not_contacted(
    tmp_path, monkeypatch
):
    system_dns(monkeypatch, "93.184.216.34")
    seen = []

    def redirect(request):
        seen.append(request.url)
        return httpx.Response(302, headers={"location": "https://169.254.169.254/metadata"})

    target = tmp_path / "blocked"
    with pytest.raises(GenerationMaterializationError, match="非公网"):
        await media.download_generated_media(
            url="https://cdn.example/video.mp4",
            target=target,
            max_bytes=100,
            transport=httpx.MockTransport(redirect),
        )
    assert len(seen) == 1
    assert not target.exists()


async def test_relative_redirect_stays_on_original_host(tmp_path, monkeypatch):
    system_dns(monkeypatch, "93.184.216.34")
    seen = []

    def download(request):
        seen.append(request)
        if len(seen) == 1:
            return httpx.Response(302, headers={"location": "../final.png?signature=abc"})
        return httpx.Response(
            200, headers={"content-type": "image/png"}, content=b"\x89PNG\r\n\x1a\ncontent"
        )

    await media.download_generated_media(
        url="https://cdn.example/folder/source.png",
        target=tmp_path / "result",
        max_bytes=100,
        transport=httpx.MockTransport(download),
    )
    assert seen[1].url.path == "/final.png"
    assert seen[1].headers["host"] == "cdn.example"
    assert seen[1].extensions["sni_hostname"] == "cdn.example"

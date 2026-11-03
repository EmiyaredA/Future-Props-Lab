"""The unmounted bridge binds exactly the original bytes and strips browser credentials."""

import base64
import hashlib

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from fpl_gateway.creative_bridge import BRIDGE_PATH, EVIDENCE_PATH, create_creative_bridge
from fpl_runtime.claims import Actor, issue_context
from fpl_runtime.creative_source_evidence import SOURCE_PATH, issue_source_evidence


async def test_original_body_is_attested_and_forwarded_without_browser_credentials():
    key = Ed25519PrivateKey.generate()
    actor = Actor("account", "user", "session", ("studio:write",), session_id="session")
    token = issue_context(
        actor, service="creative", method="POST", path=SOURCE_PATH, private_key=key, key_id="test"
    )
    import jwt

    claims = jwt.decode(
        token, key.public_key(), algorithms=["EdDSA"], issuer="fpl-identity", audience="creative"
    )
    raw = b'{ "kind": "skill", "source_id": "original" }'
    seen = []

    async def destination(request):
        seen.append(request)
        if request.url.host == "identity":
            assert request.url.path == EVIDENCE_PATH
            assert request.headers["authorization"] == "Bearer " + "g" * 48
            payload = __import__("json").loads(request.content)
            assert payload["assertion"] == token and base64.b64decode(payload["body_base64"]) == raw
            evidence = issue_source_evidence(
                actor=actor,
                request_id=claims["jti"],
                raw=raw,
                source_expiry=claims["exp"],
                private_key=key,
                key_id="test",
            )
            return httpx.Response(200, json={"evidence": evidence})
        assert request.url.host == "creative" and request.url.path == SOURCE_PATH
        assert request.content == raw
        assert "cookie" not in request.headers and "authorization" not in request.headers
        assert request.headers["x-fpl-context"] == token
        assert request.headers["x-fpl-creative-source-evidence"] != "forged"
        return httpx.Response(201, json={"created": True})

    app = create_creative_bridge(
        public_key=key.public_key(),
        gateway_credential="g" * 48,
        ingress_secret="i" * 48,
        transport=httpx.MockTransport(destination),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://bridge"
    ) as client:
        headers = {
            "X-Fpl-Bridge-Ingress": "i" * 48,
            "X-Fpl-Context": token,
            "X-Fpl-Creative-Source-Evidence": "forged",
            "Cookie": "session=secret",
            "Authorization": "Bearer browser-secret",
            "Content-Type": "application/json",
        }
        result = await client.post(BRIDGE_PATH, headers=headers, content=raw)
        assert result.status_code == 201 and result.json() == {"created": True}
        assert result.headers["cache-control"] == "no-store"
        assert len(seen) == 2 and hashlib.sha256(raw).hexdigest()
        for content in (
            b'{"kind":"skill","kind":"mcp","source_id":"x"}',
            b'{"kind":"skill","source_id":"x","extra":1}',
            b"x" * 16385,
        ):
            assert (
                await client.post(BRIDGE_PATH, headers=headers, content=content)
            ).status_code in {413, 422}
        assert (
            await client.post(
                BRIDGE_PATH, headers={**headers, "X-Fpl-Bridge-Ingress": "forged"}, content=raw
            )
        ).status_code == 403
        assert (
            await client.post(BRIDGE_PATH + "?forged=1", headers=headers, content=raw)
        ).status_code == 400
        assert (
            await client.post(
                BRIDGE_PATH, headers={**headers, "Content-Encoding": "gzip"}, content=raw
            )
        ).status_code == 400
        assert len(seen) == 2


def test_bridge_rejects_reused_credentials():
    key = Ed25519PrivateKey.generate()
    with pytest.raises(ValueError):
        create_creative_bridge(
            public_key=key.public_key(), gateway_credential="same" * 12, ingress_secret="same" * 12
        )


def bridge_fixture():
    import jwt

    key = Ed25519PrivateKey.generate()
    actors = {
        name: Actor(name, "user", "session", ("studio:write",), session_id="session-" + name)
        for name in ("alpha", "beta")
    }
    tokens = {
        name: issue_context(
            actor,
            service="creative",
            method="POST",
            path=SOURCE_PATH,
            private_key=key,
            key_id="test",
        )
        for name, actor in actors.items()
    }
    claims = {
        name: jwt.decode(
            token,
            key.public_key(),
            algorithms=["EdDSA"],
            issuer="fpl-identity",
            audience="creative",
        )
        for name, token in tokens.items()
    }
    return key, actors, tokens, claims


def request_headers(token):
    return {
        "X-Fpl-Bridge-Ingress": "i" * 48,
        "X-Fpl-Context": token,
        "Content-Type": "application/json",
    }


def fixture_evidence(key, actor, claims, raw):
    return issue_source_evidence(
        actor=actor,
        request_id=claims["jti"],
        raw=raw,
        source_expiry=claims["exp"],
        private_key=key,
        key_id="test",
    )


async def test_two_accounts_concurrent_upstream_cookies_never_forwarded():
    import asyncio
    import json

    key, actors, tokens, claims = bridge_fixture()
    seen = []
    started = 0
    both = asyncio.Event()

    async def destination(request):
        nonlocal started
        seen.append((request.url.host, request.headers.get("cookie")))
        if request.url.host == "identity":
            data = json.loads(request.content)
            name = next(name for name, token in tokens.items() if token == data["assertion"])
            raw = base64.b64decode(data["body_base64"])
            started += 1
            if started >= 2:
                both.set()
            await asyncio.wait_for(both.wait(), timeout=3)
            return httpx.Response(
                200,
                json={"evidence": fixture_evidence(key, actors[name], claims[name], raw)},
                headers={"Set-Cookie": "injected_identity=secret; Path=/"},
            )
        assert request.url.host == "creative"
        name = next(
            name for name, token in tokens.items() if token == request.headers["x-fpl-context"]
        )
        assert request.content == ('{"kind":"skill","source_id":"' + name + '"}').encode()
        return httpx.Response(
            201, json={"owner": name}, headers={"Set-Cookie": "injected_creative=secret; Path=/"}
        )

    app = create_creative_bridge(
        public_key=key.public_key(),
        gateway_credential="g" * 48,
        ingress_secret="i" * 48,
        transport=httpx.MockTransport(destination),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://bridge"
    ) as client:

        async def send(name):
            return await client.post(
                BRIDGE_PATH,
                headers=request_headers(tokens[name]),
                content=('{"kind":"skill","source_id":"' + name + '"}').encode(),
            )

        results = await asyncio.gather(send("alpha"), send("beta"))
        assert [result.json()["owner"] for result in results] == ["alpha", "beta"]
        assert (await send("alpha")).json()["owner"] == "alpha"
    assert len(seen) == 6
    assert all(cookie is None for _, cookie in seen)


@pytest.mark.parametrize(
    "failure",
    ["different_owner", "different_id", "tampered", "expired", "denied", "unavailable", "timeout"],
)
async def test_invalid_evidence_and_identity_failures_never_reach_creative(failure):
    import time

    import jwt

    key, actors, tokens, claims = bridge_fixture()
    raw = b'{"kind":"skill","source_id":"alpha"}'
    seen = []

    async def destination(request):
        seen.append(request.url.host)
        assert request.url.host == "identity"
        if failure == "denied":
            return httpx.Response(403)
        if failure == "unavailable":
            return httpx.Response(503)
        if failure == "timeout":
            raise httpx.ReadTimeout("identity timeout", request=request)
        actor = actors["beta"] if failure == "different_owner" else actors["alpha"]
        body = b'{"kind":"skill","source_id":"beta"}' if failure == "different_id" else raw
        token = fixture_evidence(key, actor, claims["alpha"], body)
        if failure == "tampered":
            header, payload, signature = token.split(".")
            signature = ("A" if signature[0] != "A" else "B") + signature[1:]
            token = ".".join((header, payload, signature))
        if failure == "expired":
            data = jwt.decode(
                token, key.public_key(), algorithms=["EdDSA"], audience="creative-source-evidence"
            )
            data["iat"], data["nbf"], data["exp"] = (
                int(time.time()) - 10,
                int(time.time()) - 10,
                int(time.time()) - 1,
            )
            token = jwt.encode(data, key, algorithm="EdDSA")
        return httpx.Response(200, json={"evidence": token})

    app = create_creative_bridge(
        public_key=key.public_key(),
        gateway_credential="g" * 48,
        ingress_secret="i" * 48,
        transport=httpx.MockTransport(destination),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://bridge"
    ) as client:
        response = await client.post(
            BRIDGE_PATH, headers=request_headers(tokens["alpha"]), content=raw
        )
    assert response.status_code == (403 if failure == "denied" else 503)
    assert seen == ["identity"]


async def test_creative_lost_reply_reports_unknown_without_retry():
    key, actors, tokens, claims = bridge_fixture()
    raw = b'{"kind":"skill","source_id":"alpha"}'
    seen = []

    async def destination(request):
        seen.append(request.url.host)
        if request.url.host == "identity":
            return httpx.Response(
                200, json={"evidence": fixture_evidence(key, actors["alpha"], claims["alpha"], raw)}
            )
        assert request.content == raw
        raise httpx.ReadTimeout("reply lost after request sent", request=request)

    app = create_creative_bridge(
        public_key=key.public_key(),
        gateway_credential="g" * 48,
        ingress_secret="i" * 48,
        transport=httpx.MockTransport(destination),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://bridge"
    ) as client:
        response = await client.post(
            BRIDGE_PATH, headers=request_headers(tokens["alpha"]), content=raw
        )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "creative_import_outcome_unknown"
    assert seen == ["identity", "creative"]


async def test_oversized_creative_reply_reports_unknown_without_retry():
    key, actors, tokens, claims = bridge_fixture()
    raw = b'{"kind":"skill","source_id":"alpha"}'
    seen = []

    async def destination(request):
        seen.append(request.url.host)
        if request.url.host == "identity":
            return httpx.Response(
                200, json={"evidence": fixture_evidence(key, actors["alpha"], claims["alpha"], raw)}
            )
        return httpx.Response(200, content=b"x" * (2 * 1024 * 1024 + 1))

    app = create_creative_bridge(
        public_key=key.public_key(),
        gateway_credential="g" * 48,
        ingress_secret="i" * 48,
        transport=httpx.MockTransport(destination),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://bridge"
    ) as client:
        response = await client.post(
            BRIDGE_PATH, headers=request_headers(tokens["alpha"]), content=raw
        )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "creative_import_outcome_unknown"
    assert seen == ["identity", "creative"]


def test_private_socket_is_owner_only_and_rejects_existing_paths():
    import os
    import stat
    import tempfile
    from pathlib import Path

    from fpl_gateway.creative_bridge import private_socket

    # macOS limits AF_UNIX paths to 103 bytes; pytest's nested tmp_path can exceed it.
    with tempfile.TemporaryDirectory(prefix="fpl-uds-", dir="/tmp") as temporary:
        root = Path(temporary)
        directory = root / "private"
        listener, path = private_socket(directory)
        try:
            assert stat.S_ISSOCK(path.stat().st_mode)
            assert stat.S_IMODE(directory.stat().st_mode) == 0o700
            assert stat.S_IMODE(path.stat().st_mode) == 0o600
            with pytest.raises(ValueError, match="already in use"):
                private_socket(directory)
            assert path.exists()
        finally:
            listener.close()
            path.unlink()
        unsafe = root / "unsafe"
        unsafe.mkdir(mode=0o755)
        os.chmod(unsafe, 0o755)
        with pytest.raises(ValueError, match="private"):
            private_socket(unsafe)
        alias = root / "alias"
        alias.symlink_to(directory)
        with pytest.raises(ValueError, match="symlink"):
            private_socket(alias)


def test_private_credentials_require_owner_only_regular_files(tmp_path):
    import os

    from fpl_gateway.creative_bridge import private_text

    credential = tmp_path / "credential"
    credential.write_text("test-token\n")
    os.chmod(credential, 0o600)
    assert private_text(credential) == "test-token"
    os.chmod(credential, 0o644)
    with pytest.raises(ValueError, match="owner-only"):
        private_text(credential)
    alias = tmp_path / "alias"
    alias.symlink_to(credential)
    with pytest.raises(ValueError, match="symlink"):
        private_text(alias)


async def test_install_bridge_attests_original_body_and_reports_ambiguous_commit():
    import json

    import jwt

    from fpl_gateway.creative_bridge import INSTALL_BRIDGE_PATH, INSTALL_EVIDENCE_PATH
    from fpl_runtime.creative_install_evidence import INSTALL_PATH, issue_install_evidence

    key = Ed25519PrivateKey.generate()
    actor = Actor("alpha", "user", "session", ("studio:write",), session_id="session")
    token = issue_context(
        actor, service="creative", method="POST", path=INSTALL_PATH, private_key=key, key_id="test"
    )
    claims = jwt.decode(
        token, key.public_key(), algorithms=["EdDSA"], issuer="fpl-identity", audience="creative"
    )
    raw = b'{ "release_id": "release", "names": {"release": "My Tool"} }'
    seen = []
    timeout = False

    async def destination(request):
        seen.append(request.url.host)
        if request.url.host == "identity":
            assert request.url.path == INSTALL_EVIDENCE_PATH
            payload = json.loads(request.content)
            assert payload["assertion"] == token and base64.b64decode(payload["body_base64"]) == raw
            evidence = issue_install_evidence(
                actor=actor,
                request_id=claims["jti"],
                raw=raw,
                source_expiry=claims["exp"],
                private_key=key,
                key_id="test",
            )
            return httpx.Response(200, json={"evidence": evidence})
        assert request.url.path == INSTALL_PATH and request.content == raw
        assert "cookie" not in request.headers and "authorization" not in request.headers
        assert request.headers["x-fpl-creative-install-evidence"] != "forged"
        if timeout:
            raise httpx.ReadTimeout("response lost", request=request)
        return httpx.Response(201, json={"id": "installed"})

    app = create_creative_bridge(
        public_key=key.public_key(),
        gateway_credential="g" * 48,
        ingress_secret="i" * 48,
        transport=httpx.MockTransport(destination),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://bridge"
    ) as client:
        headers = {
            **request_headers(token),
            "Cookie": "session=secret",
            "X-Fpl-Creative-Install-Evidence": "forged",
        }
        first = await client.post(INSTALL_BRIDGE_PATH, headers=headers, content=raw)
        assert first.status_code == 201 and seen == ["identity", "creative"]
        timeout = True
        lost = await client.post(INSTALL_BRIDGE_PATH, headers=headers, content=raw)
        assert (
            lost.status_code == 503
            and lost.json()["detail"]["code"] == "creative_install_outcome_unknown"
        )
        assert seen == ["identity", "creative", "identity", "creative"]
        duplicate = b'{"release_id":"one","release_id":"two"}'
        assert (
            await client.post(INSTALL_BRIDGE_PATH, headers=headers, content=duplicate)
        ).status_code == 422
        assert len(seen) == 4

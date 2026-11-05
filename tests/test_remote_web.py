"""Public ingress validates transport and never retries a disconnected stream."""

import pytest
from cryptography.fernet import Fernet

from studio.config import ConfigurationError, read_config
from studio.config.settings import Settings

ORIGIN = "https://studio.example.test"


@pytest.mark.asyncio
async def test_websocket_forwarding_and_stream_disconnect_never_retry():
    from studio.runtime.http.remote_web import RemoteWeb

    calls = []
    messages = []

    async def authenticate(scope, _receive):
        assert all(not name.startswith(b"x-fpl-") for name, _ in scope["headers"])

    async def upstream(scope, _receive, send):
        calls.append(scope["type"])
        if scope["type"] == "websocket":
            assert scope["scheme"] == "wss"
            await send({"type": "websocket.accept"})
            await send({"type": "websocket.close", "code": 1000})
        else:
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"text/event-stream")],
                }
            )
            await send({"type": "http.response.body", "body": b"data: once\n\n", "more_body": True})
            raise ConnectionError("simulated browser disconnect")

    async def receive():
        return {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    remote = RemoteWeb(origin=ORIGIN, port=28081, static=None, authenticate=authenticate)
    scope = {
        "type": "websocket",
        "path": "/v1/model-test/realtime",
        "server": ("127.0.0.1", 28081),
        "headers": [
            (b"host", b"studio.example.test"),
            (b"origin", ORIGIN.encode()),
            (b"x-fpl-desktop-token", b"forged"),
        ],
    }
    assert remote.accepts(scope)
    assert not remote.accepts({**scope, "server": ("127.0.0.1", 9999)})
    await remote(upstream, scope, receive, send)
    assert messages[0]["type"] == "websocket.accept"
    await remote(
        upstream,
        {
            **scope,
            "headers": [(b"host", b"studio.example.test"), (b"origin", b"https://evil.invalid")],
        },
        receive,
        send,
    )
    assert messages[-1] == {"type": "websocket.close", "code": 1008}
    with pytest.raises(ConnectionError):
        await remote(
            upstream,
            {**scope, "type": "http", "method": "GET", "path": "/v1/events"},
            receive,
            send,
        )
    assert calls == ["websocket", "http"]
    assert sum(message.get("body") == b"data: once\n\n" for message in messages) == 1


def test_remote_web_default_closed_and_configuration_validated(tmp_path):
    assert not Settings(_config_file=None).fpl_remote_web_enabled
    for origin in (
        "http://studio.example",
        "https://studio.example/",
        "https://user:secret@studio.example",
        "https://studio.example/path",
    ):
        config = tmp_path / "config.toml"
        config.write_text(f'[remote_web]\nenabled = true\norigin = "{origin}"\n')
        values = read_config(config)
        values["fpl_secrets_key"] = Fernet.generate_key().decode()
        with pytest.raises(ConfigurationError):
            Settings.validate_file_values(values)


@pytest.mark.asyncio
async def test_public_listener_restarts_after_a_real_http_connection(tmp_path):
    import json
    import socket

    import httpx
    from fastapi import FastAPI

    from studio.assembly.website.public_access import WebAccess

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    (tmp_path / "build.json").write_text(json.dumps({"build_id": "restart-test"}))
    app = FastAPI()

    @app.get("/ready")
    async def ready():
        return {"status": "ready"}

    access = WebAccess(
        app,
        Settings(_config_file=None, fpl_remote_web_port=port),
        tmp_path,
        tmp_path,
        None,
    )
    try:
        for _ in range(2):
            await access.start_local()
            async with httpx.AsyncClient(trust_env=False) as client:
                response = await client.get(f"http://127.0.0.1:{port}/ready")
                assert response.status_code == 200
            await access.stop_local()
    finally:
        await access.close()

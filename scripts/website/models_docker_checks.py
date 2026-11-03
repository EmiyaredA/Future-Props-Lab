"""Real Models HTTP/stream/asset/restart checks; synthetic data and credentials only."""

import io
import json
import subprocess
import wave
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect


def verify_models(
    *,
    client,
    unsafe,
    compose,
    started,
    wait,
    root,
    repo,
    origin,
    password,
    management_origin,
    browser_check,
):
    if urlsplit(origin).hostname != "127.0.0.1" or urlsplit(origin).port in {3000, 9000, 9001}:
        raise ValueError("Models acceptance must use an isolated loopback deployment")
    catalog = wait(client, "/v1/model-providers").json()
    local = client.get("/v1/local-models")
    assert local.status_code == 200 and local.json()["items"], (local.status_code, local.text)
    with httpx.Client(
        base_url=management_origin,
        trust_env=False,
        timeout=10,
        headers={"Origin": management_origin},
    ) as management:
        login = management.post(
            "/v1/auth/login", json={"username": "isolated-admin", "password": password}
        )
        assert login.status_code == 200, login.text
        management.headers["X-CSRF-Token"] = management.cookies["fpl_management_csrf"]
        current = management.get("/v1/platform/demo-services")
        assert current.status_code == 200, (current.status_code, current.text)
        mock = next(item for item in current.json() if item["id"] == "mock_model")
        enabled = management.post(
            "/v1/platform/demo-services/mock_model/actions",
            json={"expected_revision": mock["revision"], "action": "start"},
        )
        assert enabled.status_code == 200 and enabled.json()["ready"], enabled.text

    catalog = wait(client, "/v1/model-providers").json()
    installed = client.post(
        "/v1/account/demo-services/mock_model/install",
        headers=unsafe,
        json={"expected_catalog_revision": catalog["revision"]},
    )
    assert installed.status_code == 200, installed.text
    catalog = client.get("/v1/model-providers").json()
    model_id = next(
        model["id"]
        for provider in catalog["providers"]
        for model in provider["models"]
        if model["slug"] == "fpl-mock"
    )
    generated = client.post(
        "/v1/model-inference/text",
        headers=unsafe,
        json={"model_id": model_id, "messages": [{"role": "user", "text": "isolated model call"}]},
    )
    assert generated.status_code == 200, generated.text
    assert generated.json()["text"] == "这是本地测试模型的确定性回复。"
    assert generated.headers["cache-control"] == "no-store"
    created = client.post(
        "/v1/model-test/conversations", headers=unsafe, json={"model_id": model_id}
    )
    assert created.status_code == 200, created.text
    conversation = created.json()
    conversation_path = "/v1/model-test/conversations/" + conversation["id"]
    response = client.post(
        conversation_path + "/messages/stream",
        headers=unsafe,
        json={
            "expected_revision": conversation["revision"],
            "content": "streamed owned conversation",
        },
    )
    assert (
        response.status_code == 200 and "text/event-stream" in response.headers["content-type"]
    ), response.text
    assert '"type": "error"' not in response.text, response.text
    saved = client.get(conversation_path).json()
    assert saved["messages"][-1]["content"] == generated.json()["text"], saved

    # The independent service copies bytes through Assets rather than opening its volume.
    audio = io.BytesIO()
    with wave.open(audio, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(8000)
        target.writeframes(b"\0\0" * 800)
    uploaded = client.post(
        "/v1/files",
        headers=unsafe,
        files={"upload": ("独立模型输入.wav", audio.getvalue(), "audio/wav")},
    )
    assert uploaded.status_code == 200, uploaded.text
    source = uploaded.json()
    imported = client.post(
        "/v1/model-inference/assets/import", headers=unsafe, json={"asset_id": source["id"]}
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["filename"] == "独立模型输入.wav"
    assert imported.json()["byte_size"] == len(audio.getvalue())
    assert (
        client.delete(
            "/v1/files/" + source["id"] + "?expected_revision=" + str(source["revision"]),
            headers=unsafe,
        ).status_code
        == 200
    )
    assert (
        client.delete(
            "/v1/model-inference/assets/" + imported.json()["id"], headers=unsafe
        ).status_code
        == 204
    )

    # A plain HTTP request and a forged marker never become a websocket handshake.
    socket_path = "/v1/model-test/realtime"
    assert client.get(socket_path).status_code == 404
    assert (
        client.get(socket_path, headers={"X-Fpl-Request-Protocol": "websocket"}).status_code == 404
    )
    socket_url = origin.replace("http://", "ws://", 1) + socket_path
    try:
        with connect(socket_url, origin=origin, open_timeout=5, proxy=None):
            raise AssertionError("Unauthenticated websocket accepted")
    except InvalidStatus as error:
        assert error.response.status_code in {401, 403}, (
            error.response.status_code,
            error.response.body,
        )
    with httpx.Client(base_url=origin, trust_env=False, timeout=10) as voice:
        assert (
            voice.post(
                "/v1/auth/login", json={"username": "isolated-admin", "password": password}
            ).status_code
            == 200
        )
        cookie = "; ".join(name + "=" + value for name, value in voice.cookies.items())
        with connect(
            socket_url,
            origin=origin,
            additional_headers={"Cookie": cookie},
            open_timeout=5,
            proxy=None,
        ) as socket:
            assert (
                voice.post(
                    "/v1/auth/logout",
                    headers={"Origin": origin, "X-CSRF-Token": voice.cookies["fpl_csrf"]},
                ).status_code
                == 204
            )
            socket.send(json.dumps({"type": "start", "model_id": "unsubmitted-fixture"}))
            try:
                socket.recv(timeout=5)
                raise AssertionError("Revoked socket remained usable")
            except ConnectionClosed as error:
                assert error.rcvd and error.rcvd.code == 4403

    stable = {
        name: started(name)
        for name in ("identity", "gateway", "agents", "assets", "rendering", "management")
    }
    compose("up", "--detach", "--no-deps", "--force-recreate", "models")
    assert (
        wait(client, conversation_path).json()["messages"][-1]["content"]
        == generated.json()["text"]
    )
    assert all(started(name) == stamp for name, stamp in stable.items())
    diagnostics = compose(
        "exec",
        "-T",
        "models",
        "python",
        "-c",
        "import sqlite3; c=sqlite3.connect('file:/state/service.db?mode=ro',uri=True);"
        "assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';"
        "assert c.execute('PRAGMA foreign_key_check').fetchall()==[];"
        "tables={r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")};"
        "assert not {'users','visual_assets','platform_settings'} & tables;"
        "assert 'model_task_authorizations' in tables;print('owned models intact')",
    )
    assert "owned models intact" in diagnostics.stdout
    if browser_check:
        result = subprocess.run(
            ["node", str(Path(repo) / "web/scripts/models-service-browser-smoke.mjs")],
            cwd=repo,
            input=json.dumps(
                {
                    "origin": origin + "/",
                    "username": "isolated-admin",
                    "password": password,
                    "output": str(root / "models-browser"),
                    "repo": str(repo),
                }
            ),
            capture_output=True,
            text=True,
            timeout=180,
        )
        if result.returncode:
            raise RuntimeError("Models browser acceptance failed: " + result.stdout + result.stderr)
    return (
        "Models owns demo/catalogue/text/SSE/input copies; websocket revocation, "
        "independent restart and browser layouts preserve sibling services"
    )

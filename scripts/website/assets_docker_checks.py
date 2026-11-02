"""Isolated real-container file acceptance; fixtures never use formal data."""

import io
import json
import os
import subprocess

from PIL import Image


def exercise_assets(*, root, repo, client, unsafe, compose, started, wait, browser_check, password):
    wait(client, "/v1/file-storage/layout")
    image = io.BytesIO()
    Image.new("RGB", (12, 12), color="blue").save(image, format="PNG")
    content = image.getvalue()
    response = client.post(
        "/v1/files",
        headers=unsafe,
        files={"upload": ("container-fixture.png", content, "image/png")},
    )
    assert response.status_code == 200, response.text
    asset = response.json()
    path = f"/v1/files/{asset['id']}/content"
    response = client.get(path, headers={"Range": "bytes=0-7"})
    assert response.status_code == 206 and response.content == content[:8]
    assert response.headers["Cache-Control"] == "no-store"
    response = client.get(f"/v1/files/{asset['id']}/thumbnail?size=320")
    assert response.status_code == 200 and response.headers["Content-Type"] == "image/webp"
    response = client.get("/v1/file-library/folder-exports")
    assert response.status_code == 200 and response.content.startswith(b"PK")
    for private in ("/_internal/v1/retention/prepare", "/files/_internal/v1/retention/prepare"):
        assert client.post(private, json={}).status_code == 404
    if browser_check:
        result = subprocess.run(
            ["node", str(repo / "web/scripts/assets-service-browser-smoke.mjs")],
            cwd=repo,
            input=json.dumps(
                {
                    "origin": str(client.base_url),
                    "username": "isolated-admin",
                    "password": password,
                    "output": str(root / "assets-browser"),
                    "repo": str(repo),
                }
            ),
            text=True,
            capture_output=True,
            env=os.environ,
        )
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
    stable = {service: started(service) for service in ("identity", "agents", "gateway")}
    compose("up", "--detach", "--no-deps", "--force-recreate", "assets")
    assert wait(client, path).content == content
    assert all(started(service) == stamp for service, stamp in stable.items())
    compose("kill", "--signal", "SIGKILL", "assets")
    compose("up", "--detach", "--no-deps", "assets")
    assert wait(client, path).content == content
    diagnostic = compose(
        "exec",
        "-T",
        "assets",
        "python",
        "-c",
        "import sqlite3; db=sqlite3.connect('file:/state/service.db?mode=ro', uri=True); "
        "assert db.execute('PRAGMA integrity_check').fetchall()==[('ok',)]; "
        "assert db.execute('PRAGMA foreign_key_check').fetchall()==[]; db.close()",
    )
    assert diagnostic.returncode == 0
    compose("stop", "assets")
    assert client.get("/v1/files").status_code == 502
    assert client.get("/v1/agent-workbench/sessions").status_code == 200
    compose("up", "--detach", "--no-deps", "assets")
    assert wait(client, path).content == content
    assert all(started(service) == stamp for service, stamp in stable.items())
    return (
        "Assets owned upload, Range, private preview, archive and independent replacement survive"
    )

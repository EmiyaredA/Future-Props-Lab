"""Isolated real-container file acceptance; fixtures never use formal data."""

import io
import json
import os
import subprocess
import zipfile

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
    # Multipart spools must use the Assets-owned volume, not the 32 MiB container tmpfs.
    large = root / "large-upload.txt"
    with large.open("wb") as target:
        for _ in range(40):
            target.write(b"isolated multipart input\n".ljust(1024 * 1024, b" "))
    with large.open("rb") as source:
        response = client.post(
            "/v1/files",
            headers=unsafe,
            files={"upload": (large.name, source, "text/plain")},
            timeout=120,
        )
    assert response.status_code == 200, response.text
    uploaded = response.json()
    assert uploaded["byte_size"] == large.stat().st_size
    assert (
        client.get(f"/v1/files/{uploaded['id']}/content", headers={"Range": "bytes=0-7"}).content
        == b"isolated"
    )
    response = client.delete(
        f"/v1/files/{uploaded['id']}?expected_revision={uploaded['revision']}", headers=unsafe
    )
    assert response.status_code == 200, response.text
    large.unlink()
    packed = io.BytesIO()
    with zipfile.ZipFile(packed, "w") as bundle:
        bundle.writestr("archive-fixture/readme.txt", "isolated archive content")
    response = client.post(
        "/v1/file-library/folder-archive-imports",
        headers=unsafe,
        files={"archive": ("folder.zip", packed.getvalue(), "application/zip")},
    )
    assert response.status_code == 200 and response.json()["created_files"] == 1, response.text
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
    stable = {service: started(service) for service in ("identity", "gateway")}
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

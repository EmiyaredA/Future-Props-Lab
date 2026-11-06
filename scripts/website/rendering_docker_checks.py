"""Real media processing across the gateway, Identity, Assets and Rendering containers."""

import io
import subprocess
import wave
import zipfile

from PIL import Image
from pypdf import PdfWriter


def exercise_rendering(*, root, client, unsafe, compose, started, wait):
    video = root / "synthetic-video.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=64x48:r=4:d=1",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-y",
            str(video),
        ],
        check=True,
        timeout=30,
    )
    audio = io.BytesIO()
    with wave.open(audio, "wb") as recording:
        recording.setparams((1, 2, 8000, 8000, "NONE", "not compressed"))
        recording.writeframes(b"\0\0" * 8000)
    pdf = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=100)
    writer.write(pdf)
    files = {
        "video": (video.name, video.read_bytes(), "video/mp4"),
        "audio": ("synthetic-audio.wav", audio.getvalue(), "audio/wav"),
        "pdf": ("synthetic-document.pdf", pdf.getvalue(), "application/pdf"),
        "text": ("资料.md", "独立服务预览原文".encode(), "text/markdown"),
    }
    assets = {}
    for kind, upload in files.items():
        response = client.post("/v1/files", headers=unsafe, files={"upload": upload})
        assert response.status_code == 200, response.text
        assets[kind] = response.json()
        path = f"/v1/files/{assets[kind]['id']}"
        response = wait(client, path + "/preview")
        assert response.json()["kind"] == kind, response.text
        if kind == "text":
            assert response.json()["text"] == "独立服务预览原文"
        else:
            thumbnail = client.get(path + "/thumbnail?size=128")
            assert thumbnail.status_code == 200, thumbnail.text
            assert thumbnail.headers["cache-control"] == "no-store"
            with Image.open(io.BytesIO(thumbnail.content)) as image:
                assert image.format == "WEBP" and max(image.size) <= 128
    path = f"/v1/files/{assets['video']['id']}"
    info = client.get(path + "/media-info")
    assert info.status_code == 200, info.text
    response = client.post(path + "/frames", headers=unsafe, json={"positions_ms": [0, 250]})
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as bundle:
        assert len(bundle.namelist()) == 2
    response = client.post(
        path + "/frames",
        headers=unsafe,
        json={"positions_ms": [0, 250, 500, 750], "output": "grid"},
    )
    assert response.status_code == 200, response.text
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.format == "PNG"
    stable = {name: started(name) for name in ("identity", "gateway", "assets", "portal")}
    compose("up", "--detach", "--no-deps", "--force-recreate", "rendering")
    assert wait(client, path + "/preview").json()["kind"] == "video"
    assert all(started(name) == timestamp for name, timestamp in stable.items())
    compose("stop", "rendering")
    assert client.get(path + "/preview").status_code == 502
    assert client.get(path + "/content", headers={"Range": "bytes=0-7"}).status_code == 206
    assert client.get("/v1/agent-workbench/sessions").status_code == 200
    compose("up", "--detach", "--no-deps", "rendering")
    wait(client, path + "/preview")
    diagnostic = compose(
        "exec",
        "-T",
        "rendering",
        "python",
        "-c",
        "import sqlite3,pathlib; c=sqlite3.connect('file:/state/service.db?mode=ro',uri=True);"
        "assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';"
        "assert c.execute('PRAGMA foreign_key_check').fetchall()==[];"
        "assert 'visual_assets' not in {r[0] for r in c.execute("
        "\"SELECT name FROM sqlite_master WHERE type='table'\")};"
        "assert not list(pathlib.Path('/state/accounts').glob('*/.tmp/inputs/read-*'));"
        "assert not list(pathlib.Path('/state/accounts').glob('*/.tmp/outputs/frames-*'))",
    )
    assert diagnostic.returncode == 0
    return (
        "Rendering derives real video, audio, PDF, text and frame exports over bounded HTTP "
        "authorization; independent replacement preserves other services"
    )

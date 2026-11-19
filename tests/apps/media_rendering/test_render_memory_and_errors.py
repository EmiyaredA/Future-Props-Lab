"""Render resources follow active shots and failures remain useful and private."""

import errno
import signal
import subprocess
import sys
import threading
from types import SimpleNamespace

import pytest

from studio.apps.media_rendering import video_export_jobs
from studio.apps.media_rendering.local import render_engine
from studio.apps.media_rendering.local.inputs import RenderCaptureFrame
from studio.apps.media_rendering.local.render_errors import (
    RenderFailure,
    render_failure_message,
)
from studio.contracts.video_editor.timeline_document import parse_timeline_document


@pytest.mark.parametrize("with_seams", [False, True])
def test_completed_shots_release_real_decoders_before_next_shot(tmp_path, monkeypatch, with_seams):
    source = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=16x16:r=30:d=1",
            "-c:v",
            "libx264",
            "-y",
            str(source),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    active, opened, peak = set(), [], 0

    class Decoder(render_engine._VideoDecoder):
        def __init__(self, *args, **kwargs):
            nonlocal peak
            super().__init__(*args, **kwargs)
            active.add(self)
            opened.append(self)
            peak = max(peak, len(active))

        def close(self):
            super().close()
            active.discard(self)

    monkeypatch.setattr(render_engine, "_VideoDecoder", Decoder)
    monkeypatch.setitem(render_engine.RENDER_PRESETS, "memory-test", (16, 16, 30))
    clips = [
        {
            "id": f"c{i}",
            "name": f"Shot {i}",
            "trackId": "v",
            "kind": "video",
            "assetId": "source",
            "timelineStartUs": i * 200_000,
            "durationUs": 200_000,
            "transform": {"x": 8, "y": 8},
        }
        for i in range(12)
    ]
    document = parse_timeline_document(
        {
            "tracks": [{"id": "v", "kind": "visual", "name": "V", "order": 0, "clips": clips}],
            "transitions": [
                {
                    "id": f"s{i}",
                    "placement": "between",
                    "kind": "crossfade",
                    "fromClipId": f"c{i}",
                    "toClipId": f"c{i + 1}",
                    "durationUs": 100_000,
                }
                for i in range(11)
            ]
            if with_seams
            else [],
        }
    )
    document.settings = document.settings.model_copy(update={"width": 16, "height": 16})
    output = tmp_path / "output.mp4"
    render_engine.render_document(
        document,
        {"source": source},
        output,
        preset="memory-test",
        start_us=0,
        end_us=2_400_000,
        cancel=threading.Event(),
        progress=lambda _: None,
        capture_frame=RenderCaptureFrame(width=16, height=16),
    )
    assert len(opened) >= 12
    assert peak == (2 if with_seams else 1)
    assert not active
    assert all(d.process.poll() is not None and d.process.stdout.closed for d in opened)
    assert all(d.last is None and d.diagnostic.closed for d in opened)
    pixels = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(output),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=30,
    ).stdout
    assert len(pixels) == 72 * 16 * 16 * 3
    # Resource eviction must not introduce missing or black frames at cuts/seams.
    assert all(pixels[i] > 150 and pixels[i + 1] < 15 for i in range(0, len(pixels), 3))


def test_decoder_reports_system_kill_instead_of_holding_last_frame(tmp_path, monkeypatch):
    monkeypatch.setattr(render_engine, "_video_dimensions", lambda _: (16, 16))
    monkeypatch.setattr(render_engine, "source_frame_time", lambda *_: 0)
    decoder = render_engine._VideoDecoder(
        tmp_path / "absent.mp4", 0, 30, (16, 16), threading.Event()
    )
    try:
        decoder.process.kill()
        decoder.process.wait(timeout=5)
        with pytest.raises(RenderFailure, match="视频解码进程被系统终止") as caught:
            decoder.next()
        assert f"exit={-signal.SIGKILL}" in caught.value.diagnostic
    finally:
        decoder.close()


def test_large_ffmpeg_diagnostic_cannot_block_and_is_not_public():
    with pytest.raises(RenderFailure, match="音频合成失败") as caught:
        render_engine._run(
            [
                sys.executable,
                "-c",
                "import sys; sys.stderr.write('private-path' * 20000); sys.exit(1)",
            ],
            cancel=threading.Event(),
        )
    assert len(caught.value.diagnostic) < 4100
    assert "private-path" in caught.value.diagnostic
    assert "private-path" not in render_failure_message(caught.value, "12345678-task")


@pytest.mark.parametrize(
    "exc,expected",
    [
        (MemoryError(), "渲染内存不足"),
        (OSError(errno.ENOSPC, "secret-path"), "渲染磁盘空间不足"),
        (ValueError("secret-token"), "剪辑成片渲染失败"),
    ],
)
async def test_export_failure_receipt_has_reason_and_task_without_sensitive_text(
    tmp_path, monkeypatch, caplog, exc, expected
):
    runner = video_export_jobs.VideoExports(
        database=None, settings=None, identity=None, client=None, originals=None, outputs=None
    )
    job = SimpleNamespace(id="12345678-task", owner_user_id="alpha", payload={})
    states = []

    async def state(_job, _expected, **changes):
        states.append(changes)
        return True

    async def authorized(_job):
        return True

    def invalid(_payload):
        raise exc

    monkeypatch.setattr(runner, "set_state", state)
    monkeypatch.setattr(runner, "authorized", authorized)
    monkeypatch.setattr(runner, "folder", lambda *_: tmp_path / "job")
    monkeypatch.setattr(video_export_jobs, "VIDEO_WORK", SimpleNamespace(validate_python=invalid))
    await runner.render(job)
    assert states[-1]["status"] == "failed"
    assert expected in states[-1]["error"]
    assert "12345678" in states[-1]["error"]
    assert "secret" not in states[-1]["error"]
    assert "secret-token" not in caplog.text
    assert "12345678-task" in caplog.text and type(exc).__name__ in caplog.text

"""Produce a real Metal comparison or publish a reviewed runtime on this Mac."""

import argparse
import asyncio
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

from studio.apps.model_service.video_enhancement import media
from studio.apps.model_service.video_enhancement.tasks import VideoEnhancement
from studio.config.local_models import RELAY_MODEL_ID, compatible, definition
from studio.contracts.model_service.video_runtime import VideoMemoryError
from studio.host.local_models.files import owned_path
from studio.host.local_models.relayvsr_runtime import RUNTIME_REVISION, RelayRuntime


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def mac_model():
    return subprocess.check_output(["/usr/sbin/sysctl", "-n", "hw.model"], text=True).strip()


def check_executable(path):
    version = subprocess.check_output([path, "--version"], text=True).strip()
    if version != RUNTIME_REVISION[:7]:
        raise SystemExit("RelayVSR worker was not built from the pinned runtime revision")


def verified_weights(directory, model):
    for item in model["files"]:
        path = directory / item["path"]
        if path.stat().st_size != item["size"] or digest(path) != item["sha256"]:
            raise SystemExit(f"Weight verification failed: {path.name}")


async def benchmark(args):
    source, runtime, weights, output = (
        path.resolve() for path in (args.input, args.executable, args.weights, args.output)
    )
    check_executable(runtime)
    model = definition(RELAY_MODEL_ID)
    verified_weights(weights, model)
    video = await media.probe(source)
    if min(video.width, video.height) != 768 or video.frames < 48:
        raise SystemExit("Use a representative 768p clip with at least 48 frames")
    output.mkdir(parents=True, exist_ok=False)
    worker = RelayRuntime(runtime, weights, output)
    sample_peak = 0
    lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
    lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    lib.proc_pid_rusage.restype = ctypes.c_int

    async def measure_footprint():
        nonlocal sample_peak
        while True:
            if worker.process is not None:
                # rusage_info_v0 starts with the UUID and seven counters before ri_phys_footprint.
                record = (ctypes.c_uint64 * 12)()
                if lib.proc_pid_rusage(worker.process.pid, 0, ctypes.byref(record)) == 0:
                    sample_peak = max(sample_peak, int(record[9]))
            await asyncio.sleep(0.2)

    measuring = asyncio.create_task(measure_footprint())
    started = perf_counter()
    reduced = False
    try:
        segment = [0, 48, 0, video.frames]
        try:
            await VideoEnhancement.process_segment(source, video, segment, output, worker)
        except VideoMemoryError:
            reduced = True
            await worker.close()
            await VideoEnhancement.process_segment(
                source, video, segment, output, worker, reduced=True
            )
    finally:
        await worker.close()
        measuring.cancel()
        await asyncio.gather(measuring, return_exceptions=True)
        (output / "metal.log").write_bytes(b"".join(worker.diagnostics))
        for path in output.glob("*.rgb"):
            path.unlink()
    elapsed = perf_counter() - started
    await media.command(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-i",
        output / "original.mp4",
        "-i",
        output / "enhanced.mp4",
        "-filter_complex",
        "[0:v]scale=-2:540[a];[1:v]scale=-2:540[b];[a][b]hstack[out]",
        "-map",
        "[out]",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-crf",
        "17",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        output / "comparison.mp4",
    )
    report = {
        "hardware": mac_model(),
        "runtime_revision": RUNTIME_REVISION,
        "runtime_sha256": digest(runtime),
        "model_revision": model["revision"],
        "input_size": [video.width, video.height],
        "fps": video.fps,
        "output_frames": 48,
        "seconds": round(elapsed, 2),
        "fps_end_to_end": round(48 / elapsed, 3),
        "worker_peak_physical_footprint_bytes": sample_peak,
        "reduced_retry": reduced,
    }
    (output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)


def publish(args):
    report = json.loads(args.reviewed_report.read_text())
    executable = args.executable.resolve()
    model = definition(RELAY_MODEL_ID)
    check_executable(executable)
    if (
        report.get("runtime_revision") != RUNTIME_REVISION
        or report.get("runtime_sha256") != digest(executable)
        or report.get("model_revision") != model["revision"]
        or report.get("hardware") != mac_model()
        or report.get("output_frames") != 48
        or not report.get("worker_peak_physical_footprint_bytes")
        or not report.get("fps_end_to_end")
    ):
        raise SystemExit("The reviewed report does not verify this binary and Mac")
    target = owned_path(
        args.local_model_root.resolve(), "environments", "relayvsr", RUNTIME_REVISION
    )
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if target.exists():
        raise SystemExit("This runtime revision is already present")
    if args.weights:
        weights = args.weights.resolve()
        verified_weights(weights, model)
        cache = owned_path(args.local_model_root.resolve(), "staging", RELAY_MODEL_ID)
        cache.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not cache.exists():
            with TemporaryDirectory(dir=cache.parent) as folder:
                staged_weights = Path(folder) / "weights"
                staged_weights.mkdir(mode=0o700)
                for item in model["files"]:
                    shutil.copy2(weights / item["path"], staged_weights / item["path"])
                os.rename(staged_weights, cache)
    with TemporaryDirectory(dir=target.parent) as folder:
        staged = Path(folder) / "verified"
        staged.mkdir(mode=0o700)
        shutil.copy2(executable, staged / "fpl-relayvsr")
        (staged / "validation.json").write_text(
            json.dumps({**report, "accepted": True}, indent=2) + "\n"
        )
        os.rename(staged, target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    probe = commands.add_parser("benchmark")
    for name in ("executable", "weights", "input", "output"):
        probe.add_argument("--" + name, required=True, type=Path)
    release = commands.add_parser("publish")
    for name in ("executable", "reviewed-report", "local-model-root"):
        release.add_argument("--" + name, required=True, type=Path)
    release.add_argument("--weights", type=Path)
    args = parser.parse_args()
    if not compatible():
        raise SystemExit("RelayVSR requires macOS 15+ on Apple Silicon")
    if args.action == "benchmark":
        asyncio.run(benchmark(args))
    else:
        publish(args)


if __name__ == "__main__":
    main()

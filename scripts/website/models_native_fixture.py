"""Synthetic model implementation exercising the real Mac worker transport and receipts."""

import argparse
import asyncio
import contextlib
import json
import signal
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.llm.local_models.files import owned_path  # noqa: E402
from studio.host.local_models.models_control import ModelsControl  # noqa: E402
from studio.host.local_models.models_transport import ModelsTransport  # noqa: E402
from studio.host.local_models.models_worker import ModelsWorker  # noqa: E402


class FixtureInstaller:
    def __init__(self, root):
        self.root = root
        self.python = root / "environment/python"
        self.python.parent.mkdir(parents=True, exist_ok=True)
        self.python.write_text("synthetic interpreter marker; never executed\n")

    def model_path(self, model_id):
        return owned_path(self.root, "models", model_id)

    def is_installed(self, model):
        return (self.model_path(model["id"]) / "fixture-installed").is_file()

    async def install(self, model, report, *, repair=False):
        assert repair in {True, False}
        folder = self.model_path(model["id"])
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "config.json").write_text("{}")
        (folder / "fixture-installed").write_text(model["id"])
        await report(100)


class FixtureRuntime:
    def __init__(self, state):
        self.state = state
        self.model_id, self.process = None, None
        self.busy, self.maintenance = False, False
        self.control = asyncio.Lock()

    async def synthesize(self, model_id, payload, validate):
        await validate()
        self.model_id, self.process, self.busy = model_id, SimpleNamespace(returncode=None), True
        try:
            counter = self.state / "synthesis-count.json"
            count = json.loads(counter.read_text()) if counter.exists() else 0
            counter.write_text(json.dumps(count + 1))
            data = await asyncio.to_thread(Path(payload["reference_path"]).read_bytes)
            await asyncio.to_thread(Path(payload["output_path"]).write_bytes, data)
            return {"ok": True, "elapsed_seconds": 0.01}
        finally:
            self.busy = False

    async def close(self):
        self.model_id, self.process = None, None


async def run(options):
    state = options.state_root.resolve()
    if not state.is_relative_to(ROOT / ".local/service-split") or state.is_symlink():
        raise ValueError("Native fixture must use an isolated service acceptance root")
    subprocess.run(["git", "check-ignore", "--quiet", str(state)], cwd=ROOT, check=True)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    connection = json.loads(options.connection.read_text())
    if set(connection) != {"base_url", "credential"}:
        raise ValueError("Native fixture connection is invalid")
    transport = ModelsTransport(**connection)
    control = ModelsControl(
        state,
        state / "weights",
        installer=FixtureInstaller(state / "weights"),
        runtime=FixtureRuntime(state),
        compatible_check=lambda: True,
    )
    worker = ModelsWorker(transport, control, state)
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stopped.set)
    task = asyncio.create_task(worker.run())
    try:
        await stopped.wait()
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await control.close()
        await transport.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    asyncio.run(run(parser.parse_args()))

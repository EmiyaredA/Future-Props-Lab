"""Bounded subprocess adapter for the pinned RelayVSR Metal runtime."""

import asyncio
from collections import deque
from fractions import Fraction

from studio.contracts.model_service.video_runtime import VideoMemoryError, VideoRuntimeError

RUNTIME_REVISION = "a3c49b13be5a64a0b4da2b576af3a17e8ae1ccbf"
WEIGHTS = (
    "relayvsr_x2_lightx2v_int8_convrot.safetensors",
    "relayvsr_flash_vae_x2_fp32.safetensors",
)


class RelayRuntime:
    def __init__(self, executable, model_path, scratch):
        self.executable, self.model_path, self.scratch = executable, model_path, scratch
        self.process = None
        self.diagnostics = deque(maxlen=12)
        self.reader = None

    async def _read_diagnostics(self):
        while data := await self.process.stderr.read(4096):
            self.diagnostics.append(data)

    async def _reply(self, expected):
        line = await asyncio.wait_for(self.process.stdout.readline(), timeout=600)
        reply = line.decode(errors="replace").strip()
        if reply == expected:
            return
        if not line:
            await asyncio.wait_for(self.process.wait(), timeout=5)
            await self.reader
        diagnostics = b"".join(self.diagnostics).lower()
        if reply == "oom" or (
            not reply and (self.process.returncode == -9 or b"out of memory" in diagnostics)
        ):
            raise VideoMemoryError("Metal 内存不足")
        if reply == "busy":
            raise VideoRuntimeError("本机已有视频增强进程，请稍后继续")
        if reply == "metal_unavailable":
            raise VideoRuntimeError("当前进程无法使用 Metal")
        status = (
            reply
            if reply in {"load_failed", "input", "output", "inference", "invalid"}
            else self.process.returncode
        )
        raise VideoRuntimeError(f"RelayVSR 本机推理未完成（{status or '协议异常'}）")

    async def start(self):
        self.diagnostics.clear()
        self.process = await asyncio.create_subprocess_exec(
            self.executable,
            *(self.model_path / name for name in WEIGHTS),
            self.executable.with_name(".metal.lock"),
            cwd=self.scratch,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self.reader = asyncio.create_task(self._read_diagnostics())
        await self._reply("ready")

    async def enhance(self, video, frames):
        if self.process is None:
            await self.start()
        self.process.stdin.write(
            f"{video.width} {video.height} {frames} {round(Fraction(video.fps))}\n".encode()
        )
        await self.process.stdin.drain()
        await self._reply("ok")

    async def close(self):
        if self.process is not None:
            if self.process.returncode is None:
                try:
                    self.process.kill()
                except ProcessLookupError:
                    pass
            await self.process.wait()
            await asyncio.gather(self.reader, return_exceptions=True)
            self.process = None

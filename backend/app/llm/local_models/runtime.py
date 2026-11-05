"""One owned MLX worker and one inference at a time, with a bounded idle lifetime."""

import asyncio
import json

from app.llm.local_models.installer import worker_environment
from studio.config.local_models import HERE


class LocalRuntime:
    def __init__(self, installer, *, idle_seconds=300):
        self.installer = installer
        self.idle_seconds = idle_seconds
        self.serial = asyncio.Lock()
        self.control = asyncio.Lock()
        self.process = None
        self.model_id = None
        self.busy = False
        self.maintenance = False
        self.idle = None
        self.stderr_task = None

    async def close(self):
        if self.idle:
            self.idle.cancel()
            self.idle = None
        process, self.process = self.process, None
        self.model_id = None
        if process and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 5)
            except TimeoutError:
                process.kill()
                await process.wait()
        if self.stderr_task:
            await self.stderr_task
            self.stderr_task = None

    async def drain(self, reader):
        while await reader.read(4096):
            pass

    async def expire(self):
        await asyncio.sleep(self.idle_seconds)
        async with self.control:
            if not self.busy:
                # Do not cancel this task from close().
                self.idle = None
                await self.close()

    async def synthesize(self, model_id, payload, validate):
        async with self.serial:
            async with self.control:
                if self.maintenance:
                    raise ValueError("本地运行环境正在修复，请完成后重试")
                await validate()
                self.busy = True
                if self.idle:
                    self.idle.cancel()
                    self.idle = None
            try:
                if (
                    self.model_id != model_id
                    or not self.process
                    or self.process.returncode is not None
                ):
                    await self.close()
                    self.process = await asyncio.create_subprocess_exec(
                        str(self.installer.python),
                        str(HERE / "worker.py"),
                        str(self.installer.model_path(model_id)),
                        stdin=asyncio.subprocess.PIPE,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        env=worker_environment(),
                        limit=65536,
                    )
                    self.model_id = model_id
                    self.stderr_task = asyncio.create_task(self.drain(self.process.stderr))
                self.process.stdin.write((json.dumps(payload) + "\n").encode())
                await self.process.stdin.drain()
                raw = await asyncio.wait_for(self.process.stdout.readline(), 600)
                if not raw:
                    raise ValueError("本地语音进程已退出，请检查可用内存后重试")
                result = json.loads(raw)
                if not result.get("ok"):
                    raise ValueError(result.get("message", "本地语音合成失败"))
                return result
            except BaseException:
                await self.close()
                raise
            finally:
                async with self.control:
                    self.busy = False
                    if self.process:
                        self.idle = asyncio.create_task(self.expire())

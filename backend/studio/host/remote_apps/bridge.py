"""Bounded subprocess adapter for the Mac window host."""

import asyncio
import json
import os
import signal
import sys
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from studio.contracts.remote_desktop.apps import RemoteApp

MAX_MESSAGE = 128 * 1024


class HostUnavailable(Exception):
    pass


@asynccontextmanager
async def run_host(executable, command, *arguments):
    path = Path(executable)
    if sys.platform != "darwin" or not path.is_absolute():
        raise HostUnavailable("请在 Mac 上配置远程应用辅助程序")
    try:
        process = await asyncio.create_subprocess_exec(
            path,
            command,
            *arguments,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            limit=MAX_MESSAGE,
            start_new_session=True,
        )
    except OSError as error:
        raise HostUnavailable("远程应用辅助程序无法启动") from error
    try:
        yield process
    finally:
        process.stdin.close()
        try:
            await asyncio.wait_for(process.wait(), 2)
        except TimeoutError:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            await process.wait()


async def installed_apps(executable):
    try:
        async with run_host(executable, "catalog") as process:
            async with asyncio.timeout(8):
                line = await process.stdout.readline()
                if await process.wait() != 0:
                    raise HostUnavailable("无法读取 Mac 应用列表")
                return [RemoteApp.model_validate(item) for item in json.loads(line)]
    except (TimeoutError, ValueError, TypeError) as error:
        raise HostUnavailable("无法读取 Mac 应用列表") from error

"""Subprocess lifetime and the environment shared by native CLI transports."""

import asyncio
import os
import signal

MAX_BYTES = 16 * 1024 * 1024


class CliError(ValueError):
    pass


async def read_control_output(stream, limit):
    try:
        await stream.readexactly(limit + 1)
    except asyncio.IncompleteReadError as exc:
        return exc.partial
    raise CliError("CLI 输出超出限制")


def environment():
    names = {
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "DSH_HOME",
        "PI_CODING_AGENT_DIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    }
    return {name: value for name, value in os.environ.items() if name in names}


async def _stop(process):
    if process.returncode is not None:
        return

    def signal_tree(value):
        try:
            os.killpg(process.pid, value)
        except PermissionError:
            try:
                process.send_signal(value)
            except ProcessLookupError:
                pass
        except ProcessLookupError:
            pass

    signal_tree(signal.SIGTERM)
    try:
        await asyncio.wait_for(process.wait(), 5)
    except TimeoutError:
        signal_tree(signal.SIGKILL)
        await process.wait()


async def close_transport(process):
    async def drain():
        if process.stdout:
            while await process.stdout.read(65536):
                pass

    draining = asyncio.create_task(drain())
    if process.stdin:
        process.stdin.close()
    await _stop(process)
    if process.stdin:
        try:
            await process.stdin.wait_closed()
        except (BrokenPipeError, ConnectionResetError):
            pass
    try:
        await asyncio.wait_for(draining, 2)
    except TimeoutError:
        draining.cancel()
        await asyncio.gather(draining, return_exceptions=True)


async def spawn_transport(*args, **kwargs):
    creating = asyncio.create_task(asyncio.create_subprocess_exec(*args, **kwargs))
    try:
        return await asyncio.shield(creating)
    except asyncio.CancelledError:
        process = await creating
        await close_transport(process)
        raise

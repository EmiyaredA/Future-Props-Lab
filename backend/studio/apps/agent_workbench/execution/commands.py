"""Run only configured argv vectors in a macOS project sandbox."""

import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
from contextlib import suppress
from functools import cache
from pathlib import Path

from app.runtime.safe_paths import PRIVATE_NAMES, PRIVATE_SUFFIXES

SANDBOX = Path("/usr/bin/sandbox-exec")
MAX_OUTPUT = 64 * 1024


@cache
def available():
    if sys.platform != "darwin" or not SANDBOX.is_file():
        return False
    try:
        probe = subprocess.run(
            [str(SANDBOX), "-p", "(version 1)(allow default)", "/usr/bin/true"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=3,
            check=False,
        )
        return probe.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def profile(root, temporary, executables, runtime_roots):
    readable = [root, temporary, *runtime_roots, "/System/Library", "/usr/lib", *executables]
    metadata = {str(parent) for path in readable for parent in Path(path).parents}
    reads = " ".join(f"(subpath {json.dumps(str(path), ensure_ascii=False)})" for path in readable)
    parents = " ".join(
        f"(literal {json.dumps(path, ensure_ascii=False)})" for path in sorted(metadata)
    )
    allowed_exec = " ".join(
        f"(literal {json.dumps(path, ensure_ascii=False)})" for path in executables
    )

    # Reject hidden and credential paths regardless of the file tool entry point.
    def literal_pattern(value):
        return "".join(
            f"[{char.lower()}{char.upper()}]"
            if char.isascii() and char.isalpha()
            else re.escape(char)
            for char in value
        )

    private = "|".join(literal_pattern(name) for name in sorted(PRIVATE_NAMES))
    suffix = "|".join(literal_pattern(ext) for ext in PRIVATE_SUFFIXES)
    pattern = f"^{literal_pattern(root)}/(.*/)?([.][^/]*|{private}|[^/]*({suffix}))(/|$)"
    writable = json.dumps(temporary, ensure_ascii=False)
    return "\n".join(
        (
            "(version 1)",
            "(deny default)",
            "(allow process-fork)",
            "(allow sysctl-read)",
            # macOS needs to read the root directory vnode while starting a process.
            '(allow file-read-data (literal "/"))',
            f"(allow file-read-metadata {parents})",
            f'(allow file-read* {reads} (literal "/dev/null"))',
            f"(deny file-read* (regex {json.dumps(pattern, ensure_ascii=False)}))",
            f'(allow file-write* (subpath {writable}) (literal "/dev/null"))',
            f"(allow process-exec {allowed_exec})",
        )
    )


async def run_command(root, command):
    if not available():
        raise ValueError("macOS 命令沙箱不可用")
    resolved = [
        str(Path(path).resolve(strict=True)) for path in (command.argv[0], *command.executables)
    ]
    runtime = [str(Path(path).resolve(strict=True)) for path in command.runtime_roots]
    # Runtime roots are narrow trusted dependency locations, never a whole home or volume.
    if any(
        len(Path(path).parts) < 3
        or Path.home().resolve().is_relative_to(path)
        or Path(root).is_relative_to(path)
        for path in runtime
    ):
        raise ValueError("命令运行时目录过宽")
    with tempfile.TemporaryDirectory(prefix="fpl-cloud-command-") as work:
        work = str(Path(work).resolve())
        process = await asyncio.create_subprocess_exec(
            str(SANDBOX),
            "-p",
            profile(root, work, resolved, runtime),
            resolved[0],
            *command.argv[1:],
            cwd=root,
            env={
                "HOME": work,
                "TMPDIR": work,
                "PATH": os.pathsep.join(dict.fromkeys(str(Path(path).parent) for path in resolved)),
            },
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            async with asyncio.timeout(120):
                chunks = bytearray()
                while chunk := await process.stdout.read(16384):
                    chunks.extend(chunk)
                    if len(chunks) > MAX_OUTPUT:
                        raise ValueError("命令输出超过限制")
                await process.wait()
                return {"exit_code": process.returncode, "output": chunks.decode(errors="replace")}
        finally:
            # A preset may leave children in its group after the leader exits.
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            await process.wait()

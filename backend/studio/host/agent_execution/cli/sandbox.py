"""Explicit macOS process policies; workspace access is enforced by the kernel."""

import asyncio
import re
import shutil
import subprocess
import sys
from pathlib import Path

from .transport import CliError, close_transport

SANDBOX = Path("/usr/bin/sandbox-exec")
SYSTEM_READ = (
    Path("/System/Library"),
    Path("/System/Volumes/Preboot/Cryptexes/OS"),
    Path("/usr/lib"),
    Path("/usr/share"),
    Path("/bin"),
    Path("/usr/bin"),
    Path("/private/etc/ssl"),
    Path("/private/etc/hosts"),
    Path("/private/etc/resolv.conf"),
    Path("/private/etc/localtime"),
    Path("/dev/null"),
    Path("/dev/urandom"),
    Path("/dev/random"),
    Path("/dev/zero"),
)


def quote(path):
    return '"' + str(path).replace("\\", "\\\\").replace('"', '\\"') + '"'


def library_paths(executable):
    """Resolve the installed Mach-O dependency closure, not entire Homebrew prefixes."""
    executable = Path(executable).resolve()
    pending, visited, paths, rpaths = [executable], set(), set(), set()
    while pending:
        binary = pending.pop()
        if binary in visited:
            continue
        visited.add(binary)
        if len(visited) > 128:
            raise CliError("CLI 动态库依赖超过限制")
        result = subprocess.run(
            ["/usr/bin/otool", "-L", str(binary)], capture_output=True, timeout=5, check=False
        )
        if result.returncode:
            continue  # scripts and non-Mach-O resources have no load commands
        commands = subprocess.run(
            ["/usr/bin/otool", "-l", str(binary)], capture_output=True, timeout=5, check=False
        ).stdout.decode()
        for entry in re.findall(r"cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset", commands):
            entry = entry.replace("@loader_path", str(binary.parent)).replace(
                "@executable_path", str(executable.parent)
            )
            if entry.startswith("/"):
                rpaths.add(Path(entry).resolve())
        for line in result.stdout.decode().splitlines()[1:]:
            name = line.strip().split(" (", 1)[0]
            if name.startswith("/System/") or name.startswith("/usr/lib/"):
                continue
            if name.startswith("@loader_path/"):
                name = str(binary.parent / name.removeprefix("@loader_path/"))
            elif name.startswith("@executable_path/"):
                name = str(executable.parent / name.removeprefix("@executable_path/"))
            elif name.startswith("@rpath/"):
                suffix = name.removeprefix("@rpath/")
                found = next(
                    (base / suffix for base in sorted(rpaths) if (base / suffix).is_file()), None
                )
                if found is not None:
                    name = str(found)
            if not name.startswith("/"):
                raise CliError("CLI 包含未登记的相对动态库依赖")
            path = Path(name)
            if path.is_file():
                # dyld follows versioned dylib symlinks through intermediate names.
                # Grant only the library directory of this declared dependency.
                paths.update((path.parent, path.parent.resolve()))
                pending.append(path.resolve())
    return paths


def program_paths(executable):
    """Allow the installed program's bundle, never an ancestor home/repository."""
    path = Path(executable).resolve(strict=True)
    paths = {path, Path(executable).absolute()}
    paths.update(library_paths(path))
    for parent in path.parents:
        if (parent / ".git").exists() or parent == Path.home() or parent == Path("/"):
            break
        if (parent / "package.json").is_file():
            paths.add(parent)
            break
    with path.open("rb") as stream:
        first = stream.read(256).split(b"\n", 1)[0]
    if first.startswith(b"#!"):
        words = first[2:].decode(errors="strict").split()
        interpreter = words[0]
        if interpreter == "/usr/bin/env":
            if len(words) != 2 or words[1].startswith("-"):
                raise CliError("CLI 解释器声明不受支持")
            interpreter = shutil.which(words[1])
        if not interpreter:
            raise CliError("CLI 解释器不可用")
        resolved = Path(interpreter).resolve(strict=True)
        paths.add(Path(interpreter).absolute())
        paths.add(resolved)
        paths.update(library_paths(resolved))
        if "python" in resolved.name:
            paths.add(Path(sys.base_prefix).resolve())
            paths.add(Path(interpreter).parent.parent / "pyvenv.cfg")
        # Node/Bun standalone installs can load adjacent native libraries.
        if resolved.parent.name == "bin":
            library = resolved.parent.parent / "lib"
            if library.is_dir() and not (library.parent / ".git").exists():
                # Never grant the entire global npm package tree.
                paths.update(library.glob("*.dylib"))
    return paths


def program_command(args):
    """Resolve a shebang explicitly, avoiding implicit interpreter searches outside policy."""
    executable = Path(args[0]).resolve(strict=True)
    with executable.open("rb") as file:
        line = file.read(256).split(b"\n", 1)[0]
    if not line.startswith(b"#!"):
        return [str(executable), *args[1:]]
    words = line[2:].decode().split()
    if words[0] == "/usr/bin/env":
        if len(words) != 2 or words[1].startswith("-"):
            raise CliError("CLI 解释器声明不受支持")
        interpreter = shutil.which(words[1])
        if not interpreter:
            raise CliError("CLI 解释器不可用")
        words = [interpreter]
    if words[0] == "/bin/sh":
        words = ["/bin/bash", "--posix", "--noprofile", "--norc", *words[1:]]
    return [str(Path(words[0]).resolve(strict=True)), *words[1:], str(executable), *args[1:]]


class ProcessSandbox:
    def __init__(self, *, read=(), write=(), sockets=(), network=False, script=False):
        self.read = tuple(Path(p).absolute() for p in read)
        self.write = tuple(Path(p).resolve() for p in write)
        self.sockets = tuple(Path(p).resolve() for p in sockets)
        self.network, self.script = network, script
        if any(p in {Path("/"), Path.home()} for p in (*self.read, *self.write)):
            raise CliError("沙箱不能授权整个主目录或文件系统")

    def profile(self):
        reads = {*SYSTEM_READ, *self.read, *self.write}
        ancestors = {p for path in (*reads, *self.sockets) for p in path.parents}
        rules = [
            "(version 1)",
            "(allow default)",
            "(deny file-read*)",
            "(deny file-write*)",
            "(deny network*)",
            "(deny appleevent-send)",
            '(deny mach-lookup (global-name "com.apple.securityd") '
            '(global-name "com.apple.securityd.xpc"))',
            "(deny file-map-executable)",
            # macOS dyld shared-cache boot requires reading the root vnode itself.
            # This is a literal, not a recursive grant to the filesystem.
            '(allow file-read* (literal "/"))',
        ]
        # Runtime libraries are executable mappings, not authority to read business files.
        rules += [
            "(allow file-read* file-map-executable "
            + " ".join(
                f"(subpath {quote(p)})" if p.is_dir() else f"(literal {quote(p)})"
                for p in sorted(reads, key=str)
            )
            + ")"
        ]
        rules += [
            "(allow file-read-metadata "
            + " ".join(f"(literal {quote(p)})" for p in sorted(ancestors, key=str))
            + ")"
        ]
        if self.write:
            rules += [
                "(allow file-write* " + " ".join(f"(subpath {quote(p)})" for p in self.write) + ")"
            ]
        if self.network:
            rules += ["(allow network-outbound network-bind)"]
        else:
            for path in self.sockets:
                rules += [f"(allow network-outbound (remote unix-socket (literal {quote(path)})))"]
        if self.script:
            rules += ["(deny mach-lookup)", "(deny process-info*)", "(deny signal)"]
        return "\n".join(rules)

    def command(self, args):
        if sys.platform != "darwin" or not SANDBOX.is_file():
            raise CliError("当前主机不支持 Amadeus 文件系统沙箱；拒绝非隔离运行")
        return [str(SANDBOX), "-p", self.profile(), *map(str, args)]


async def verify_sandbox():
    """A working deny rule is required; checking binary existence is insufficient."""
    policy = ProcessSandbox(script=True)
    command = policy.command(["/bin/cat", str(Path(__file__).resolve())])
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, error = await asyncio.wait_for(process.communicate(), 3)
        if (
            process.returncode == 0
            or b"Operation not permitted" not in error
            or b"sandbox_apply" in error
        ):
            raise CliError("Amadeus 系统沙箱未通过拒读验证")
    finally:
        await close_transport(process)


def clean_script_environment(root, runtime, socket_path, token):
    return {
        "PATH": f"{runtime / 'bin'}:/usr/bin:/bin",
        "HOME": str(root),
        "TMPDIR": str(root / "tmp"),
        "LANG": "en_US.UTF-8",
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "FPL_TASK_SOCKET": str(socket_path),
        "FPL_TASK_TOKEN": token,
    }

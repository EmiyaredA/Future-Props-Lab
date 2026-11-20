"""Publish a source-independent, read-only Python SDK runtime for sandboxed scripts."""

import fcntl
import hashlib
import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from .transport import CliError

MODULES = (
    "future_props_lab",
    "httpx",
    "httpcore",
    "h11",
    "anyio",
    "idna",
    "certifi",
    "typing_extensions",
    "typing_inspection",
    "annotated_types",
    "pydantic",
    "pydantic_core",
    "websockets",
    "sniffio",
)


def module_sources():
    sources = []
    for name in MODULES:
        spec = importlib.util.find_spec(name)
        if spec is None:
            if name == "sniffio":
                continue
            raise CliError(f"脚本运行环境缺少依赖：{name}")
        path = Path(spec.origin).resolve(strict=True)
        sources.append(path.parent if spec.submodule_search_locations else path)
    return sources


def prepare_runtime(runtime_path):
    sources = module_sources()
    digest = hashlib.sha256(str(Path(sys.base_prefix).resolve()).encode())
    for path in sources:
        for file in sorted(path.rglob("*") if path.is_dir() else [path]):
            if file.is_file() and "__pycache__" not in file.parts:
                digest.update(str(file).encode())
                digest.update(file.read_bytes())
    runner = Path(__file__).with_name("workspace_python.py")
    digest.update(runner.read_bytes())
    parent = Path(runtime_path) / "agent-workspace"
    if parent.is_symlink():
        raise CliError("脚本运行环境不能经过符号链接")
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent = parent.resolve()
    target = parent / digest.hexdigest()[:24]
    with (parent / "publish.lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if (target / "ready.json").is_file():
            return target
        with TemporaryDirectory(prefix=".prepare-", dir=parent) as directory:
            stage = Path(directory)
            (stage / "site").mkdir()
            (stage / "bin").mkdir()
            for source in sources:
                destination = stage / "site" / source.name
                if source.is_dir():
                    shutil.copytree(
                        source, destination, ignore=shutil.ignore_patterns("__pycache__", "*.pyc")
                    )
                else:
                    shutil.copyfile(source, destination)
            shutil.copyfile(runner, stage / "python.py")
            for name, suffix in (
                ("python", ""),
                ("python3", ""),
                ("fpl", " -m future_props_lab.cli"),
            ):
                script = stage / "bin" / name
                # Use the base interpreter, never the backend editable virtualenv.
                executable = Path(getattr(sys, "_base_executable", sys.executable)).resolve()
                script.write_text(
                    f"#!/bin/sh\nexec '{executable}' -I '{target / 'python.py'}'{suffix} \"$@\"\n"
                )
                script.chmod(0o500)
            (stage / "ready.json").write_text(json.dumps({"digest": digest.hexdigest()}))
            os.rename(stage, target)
    return target

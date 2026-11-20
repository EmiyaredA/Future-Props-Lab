"""Pinned official MLX runtime, isolated from the Qwen environment."""

import asyncio
import hashlib
import os
import shutil
from pathlib import Path
from uuid import uuid4

from studio.config.local_models import manifest, required_disk_bytes
from studio.host.local_models import downloads
from studio.host.local_models.environment import command, extract, worker_environment
from studio.host.local_models.files import owned_path

HERE = Path(__file__).parent


def environment_stamp(model):
    lock = hashlib.sha256((HERE / "zonos_requirements.txt").read_bytes()).hexdigest()
    return model["environment_version"] + ":" + lock


def environment_ready(installer, model):
    marker = owned_path(installer.environment_path(model["id"]), "ready")
    return (
        installer.python_for(model["id"]).is_file()
        and marker.is_file()
        and marker.read_text().strip() == environment_stamp(model)
    )


async def prepare_environment(installer, model, client):
    root = installer.environment_path(model["id"])
    if root.exists():
        await asyncio.to_thread(shutil.rmtree, root)
    for kind in ("uv", "python"):
        item = manifest()[kind]
        archive = owned_path(installer.root, "downloads", item["sha256"] + ".tar.gz")
        await downloads.fetch_file(client, item, archive)
        await asyncio.to_thread(extract, archive, root / kind)
    item = model["source"]
    archive = owned_path(installer.root, "downloads", item["sha256"] + ".tar.gz")
    await downloads.fetch_file(client, item, archive)
    await asyncio.to_thread(extract, archive, root / "source")
    sources = list((root / "source").iterdir())
    if len(sources) != 1 or not (sources[0] / "model" / "pyproject.toml").is_file():
        raise ValueError("ZONOS3 官方源码归档结构不匹配")
    uv = owned_path(root, "uv", "uv-aarch64-apple-darwin", "uv")
    py = owned_path(root, "python", "python", "bin", "python3", allow_leaf_symlink=True)
    python = installer.python_for(model["id"])
    env = worker_environment()
    env.update(
        UV_CACHE_DIR=str(installer.root / "downloads" / "uv-cache"),
        UV_NO_CONFIG="1",
        UV_PYTHON_DOWNLOADS="never",
    )
    await command(uv, "venv", "--python", py, python.parents[1], env=env)
    await command(
        uv,
        "pip",
        "sync",
        "--python",
        python,
        "--require-hashes",
        "--default-index",
        "https://pypi.org/simple",
        HERE / "zonos_requirements.txt",
        timeout=1800,
        env=env,
    )
    # No editing/FuseAlign dependency: the two packages are built from the verified
    # official source and use the transitive versions/hashes in its frozen uv lock.
    await command(
        uv,
        "pip",
        "install",
        "--python",
        python,
        "--no-deps",
        "--no-build-isolation",
        sources[0] / "model",
        sources[0] / "servers" / "mlx",
        env=env,
    )
    await command(
        python,
        "-c",
        "from zonos3_mlx.engine import Engine; from zonos3_mlx.scheduler import Scheduler",
        env=worker_environment(),
    )
    (root / "ready").write_text(environment_stamp(model) + "\n")


async def install(installer, model, report, *, repair=False):
    installer.root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if shutil.disk_usage(installer.root).free < required_disk_bytes(model):
        raise ValueError("磁盘空间不足，请释放空间后重试")
    if repair:
        for item in model["files"]:
            path = owned_path(installer.model_path(model["id"]), item["path"])
            if not path.is_file() or not installer.verified_file(
                path, item["sha256"], item["size"]
            ):
                raise ValueError("模型权重校验失败，运行环境与原权重均未修改")
    root = installer.environment_path(model["id"])
    previous, accepted = None, False
    # A failed repair restores only this model's previous environment.
    if repair and root.exists():
        previous = root.with_name("previous-" + uuid4().hex)
        root.rename(previous)
    try:
        async with downloads.client() as client:
            if repair or not environment_ready(installer, model):
                await prepare_environment(installer, model, client)
            staging = owned_path(installer.root, "staging", model["id"])
            size = sum(item["size"] for item in model["files"])
            completed = 0
            if not repair:
                for item in model["files"]:

                    async def progress(count, previous=completed):
                        await report(int((previous + count) * 95 / size))

                    cache = owned_path(installer.root, "downloads", item["sha256"])
                    await downloads.fetch_file(client, item, cache, progress)
                    target = owned_path(staging, item["path"])
                    target.parent.mkdir(parents=True, exist_ok=True)
                    # Copy, rather than hard-link: uninstall/staging mutations cannot
                    # modify the verified reusable download cache.
                    await asyncio.to_thread(shutil.copyfile, cache, target)
                    completed += item["size"]
                    await report(int(completed * 95 / size))
            await command(
                installer.python_for(model["id"]),
                HERE / "zonos_worker.py",
                "--check",
                installer.model_path(model["id"]) if repair else staging,
                timeout=300,
                env=worker_environment(),
            )
            if not repair:
                final = installer.model_path(model["id"])
                final.parent.mkdir(parents=True, exist_ok=True)
                if final.exists():
                    await asyncio.to_thread(shutil.rmtree, final)
                os.replace(staging, final)
            accepted = True
            await report(100)
    finally:
        if previous and previous.exists():
            if accepted:
                await asyncio.to_thread(shutil.rmtree, previous)
            else:
                if root.exists():
                    root.rename(root.with_name("failed-" + uuid4().hex))
                previous.rename(root)

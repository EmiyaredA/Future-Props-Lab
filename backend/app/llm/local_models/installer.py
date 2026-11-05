"""Install a separately managed Python environment; no dependency on system Python/uv."""

import asyncio
import hashlib
import os
import shutil
import tarfile
from uuid import uuid4

from app.llm.local_models import downloads
from app.llm.local_models.files import owned_path
from studio.config.local_models import HERE, manifest


async def command(*args, timeout=900, env=None):
    proc = await asyncio.create_subprocess_exec(
        *map(str, args),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout)
        if proc.returncode:
            raise ValueError("本地语音运行环境安装或自检失败")
        return stdout
    finally:
        if proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 5)
            except TimeoutError:
                proc.kill()
                await proc.wait()


def extract(archive, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as source:
        source.extractall(destination, filter="data")


def worker_environment():
    allowed = {
        "PATH",
        "HOME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "https_proxy",
        "http_proxy",
        "all_proxy",
        "no_proxy",
    }
    env = {key: value for key, value in os.environ.items() if key in allowed}
    env.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", PYTHONNOUSERSITE="1")
    return env


class Installer:
    def __init__(self, root):
        self.root = root
        self.lock = asyncio.Lock()
        self._verification_cache = {}

    @property
    def python(self):
        return self.root / "environments" / "v1" / "venv" / "bin" / "python"

    def model_path(self, model_id):
        return owned_path(self.root, "models", model_id)

    def is_installed(self, model):
        try:
            executable = owned_path(
                self.root, "environments", "v1", "venv", "bin", "python", allow_leaf_symlink=True
            )
            marker = owned_path(self.root, "environments", "v1", "ready")
            model_root = self.model_path(model["id"])
            if (
                not executable.is_file()
                or not marker.is_file()
                or marker.read_text().strip() != "1"
            ):
                return False
            for item in model["files"]:
                path = owned_path(model_root, item["path"])
                if not path.is_file() or path.stat().st_size != item["size"]:
                    return False
                metadata = path.stat()
                stamp = (metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns)
                cached = self._verification_cache.get(path)
                if cached != (stamp, item["sha256"]):
                    with path.open("rb") as source:
                        checksum = hashlib.file_digest(source, "sha256").hexdigest()
                    after = path.stat()
                    if checksum != item["sha256"] or stamp != (
                        after.st_dev,
                        after.st_ino,
                        after.st_size,
                        after.st_mtime_ns,
                    ):
                        return False
                    self._verification_cache[path] = (stamp, checksum)
            return True
        except (OSError, ValueError):
            return False

    async def install(self, model, report, *, repair=False):
        async with self.lock:
            size = sum(x["size"] for x in model["files"])
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            if shutil.disk_usage(self.root).free < size * 2 + 2 * 1024**3:
                raise ValueError("磁盘空间不足，请释放空间后重试")
            env_root = owned_path(self.root, "environments", "v1")
            for relative in (
                "downloads",
                "environments/v1/uv",
                "environments/v1/python",
                "environments/v1/venv",
                "staging/" + model["id"],
            ):
                owned_path(self.root, relative)
            if repair:
                for item in model["files"]:
                    path = self.model_path(model["id"]) / item["path"]
                    if (
                        not path.is_file()
                        or path.stat().st_size != item["size"]
                        or await downloads.digest(path) != item["sha256"]
                    ):
                        raise ValueError("模型权重校验失败，运行环境与原权重均未修改")
            previous = None
            repaired = False
            if repair and env_root.exists():
                previous = env_root.with_name("previous-" + uuid4().hex)
                env_root.rename(previous)
            try:
                async with downloads.client() as client:
                    if repair or not (env_root / "ready").is_file() or not self.python.is_file():
                        # Interrupted extraction or dependency installation is never trusted.
                        # Verified archives live outside this directory and remain resumable.
                        if env_root.exists():
                            await asyncio.to_thread(shutil.rmtree, env_root)
                        for kind in ("uv", "python"):
                            item = manifest()[kind]
                            archive = self.root / "downloads" / (item["sha256"] + ".tar.gz")
                            await downloads.fetch_file(client, item, archive)
                            destination = env_root / kind
                            if not destination.exists():
                                await asyncio.to_thread(extract, archive, destination)
                        uv = owned_path(env_root, "uv", "uv-aarch64-apple-darwin", "uv")
                        py = owned_path(
                            env_root, "python", "python", "bin", "python3", allow_leaf_symlink=True
                        )
                        install_env = worker_environment()
                        install_env.update(
                            UV_CACHE_DIR=str(self.root / "downloads" / "uv-cache"),
                            UV_NO_CONFIG="1",
                            UV_PYTHON_DOWNLOADS="never",
                        )
                        await command(
                            uv, "venv", "--python", py, self.python.parents[1], env=install_env
                        )
                        await command(
                            uv,
                            "pip",
                            "sync",
                            "--python",
                            self.python,
                            "--require-hashes",
                            "--default-index",
                            "https://pypi.org/simple",
                            "--only-binary",
                            ":all:",
                            HERE / "requirements.txt",
                            env=install_env,
                        )
                        await command(
                            self.python,
                            "-c",
                            "import mlx.core, mlx_audio, soundfile",
                            env=worker_environment(),
                        )
                        (env_root / "ready").write_text("1\n")
                    if repair:
                        await command(
                            self.python,
                            HERE / "worker.py",
                            "--check",
                            self.model_path(model["id"]),
                            timeout=300,
                            env=worker_environment(),
                        )
                        await report(100)
                        repaired = True
                        return
                    staging = owned_path(self.root, "staging", model["id"])
                    completed = 0
                    for item in model["files"]:

                        async def progress(count, previous=completed):
                            await report(int((previous + count) * 95 / size))

                        await downloads.fetch_file(client, item, staging / item["path"], progress)
                        completed += item["size"]
                        await report(int(completed * 95 / size))
                    await command(
                        self.python,
                        HERE / "worker.py",
                        "--check",
                        staging,
                        timeout=300,
                        env=worker_environment(),
                    )
                    final = self.model_path(model["id"])
                    if final.exists():
                        await asyncio.to_thread(shutil.rmtree, final)
                    final.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(staging, final)
            finally:
                if previous and previous.exists():
                    if repaired:
                        await asyncio.to_thread(shutil.rmtree, previous)
                    else:
                        if env_root.exists():
                            env_root.rename(env_root.with_name("failed-" + uuid4().hex))
                        previous.rename(env_root)

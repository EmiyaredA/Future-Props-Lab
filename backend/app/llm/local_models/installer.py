"""Install a separately managed Python environment; no dependency on system Python/uv."""

import asyncio
import os
import shutil
import tarfile

from app.llm.local_models import downloads
from app.llm.local_models.catalog import HERE, manifest


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

    @property
    def python(self):
        return self.root / "environments" / "v1" / "venv" / "bin" / "python"

    def model_path(self, model_id):
        return self.root / "models" / model_id

    async def install(self, model, report):
        async with self.lock:
            size = sum(x["size"] for x in model["files"])
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            if shutil.disk_usage(self.root).free < size * 2 + 2 * 1024**3:
                raise ValueError("磁盘空间不足，请释放空间后重试")
            env_root = self.python.parents[2]
            async with downloads.client() as client:
                if not (env_root / "ready").is_file() or not self.python.is_file():
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
                    uv = env_root / "uv" / "uv-aarch64-apple-darwin" / "uv"
                    py = env_root / "python" / "python" / "bin" / "python3"
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
                staging = self.root / "staging" / model["id"]
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

"""Host-side publication of immutable App frontend releases."""

import fcntl
import json
import os
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from studio.contracts.gateway.catalog import BY_ID
from studio.runtime.http.web import BUILD_ID, RELEASE_MOUNT, load_release

WEB_APPS = frozenset(service.id for service in BY_ID.values() if service.page_roots) - {
    "identity",
}


def stage(source: Path, directory: Path, service: str):
    directory.mkdir(parents=True, exist_ok=True)
    release = load_release(source, service)
    target = directory / release.build_id
    if target.exists():
        existing = load_release(target, service)
        if existing.files != release.files or existing.api_sha256 != release.api_sha256:
            raise ValueError("该构建 ID 已登记不同内容")
        return existing
    with TemporaryDirectory(dir=directory, prefix=".stage-") as temporary:
        candidate = Path(temporary) / release.build_id
        shutil.copytree(source, candidate)
        copied = load_release(candidate, service)
        if copied != release.__class__(
            candidate.resolve(),
            release.service,
            release.build_id,
            release.api_sha256,
            release.entry,
            release.files,
        ):
            raise ValueError("复制期间构建内容已变化")
        os.rename(candidate, target)
    return load_release(target, service)


def activate(directory: Path, service: str, build_id: str, *, expected: str, api_sha256: str):
    if not BUILD_ID.fullmatch(build_id) or not BUILD_ID.fullmatch(expected):
        raise ValueError("构建 ID 无效")
    with (directory / ".publish.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        pointer = directory / "current"
        if pointer.is_symlink() or not pointer.is_file():
            raise ValueError("尚未初始化当前构建；请先登记运行中的版本")
        selected_id = pointer.read_text().strip()
        if not BUILD_ID.fullmatch(selected_id):
            raise ValueError("当前构建指针无效")
        if selected_id != expected:
            selected = load_release(directory / selected_id, service)
            if selected.api_sha256 == api_sha256:
                raise ValueError("当前构建已变化；重新核对后再发布")
            # A backend rollout can leave an incompatible pointer. The live
            # manifest then reports the staged, baked release as its fallback.
        previous = load_release(directory / expected, service)
        target = load_release(directory / build_id, service)
        if (
            previous.build_id != expected
            or target.build_id != build_id
            or previous.api_sha256 != api_sha256
            or target.api_sha256 != api_sha256
        ):
            raise ValueError("当前构建或候选构建与运行中的 API 契约不同")
        with TemporaryDirectory(dir=directory, prefix=".pointer-") as temporary:
            candidate = Path(temporary) / "current"
            candidate.write_text(build_id + "\n")
            os.replace(candidate, pointer)
    return target


def seed(source: Path, directory: Path, service: str):
    release = stage(source, directory, service)
    with (directory / ".publish.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with (directory / "current").open("x") as pointer:
            pointer.write(release.build_id + "\n")
    return release


def compose_override(root: Path, apps: list[str]):
    if not apps or not set(apps) <= WEB_APPS:
        raise ValueError("包含不支持独立前端发布的应用")
    services = {}
    for app in sorted(set(apps)):
        directory = root.resolve() / app
        if not directory.is_dir() or directory.is_symlink():
            raise ValueError(f"{app} 缺少独立前端版本目录")
        services[app] = {
            "volumes": [
                {
                    "type": "bind",
                    "source": str(directory),
                    "target": str(RELEASE_MOUNT),
                    "read_only": True,
                    "bind": {"create_host_path": False},
                }
            ]
        }
    return json.dumps({"services": services}, ensure_ascii=False, indent=2) + "\n"

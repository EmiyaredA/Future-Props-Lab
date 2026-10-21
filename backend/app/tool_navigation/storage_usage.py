"""On-demand capacity reads and handoff to the installed macOS applications."""

import os
import plistlib
import shutil
import stat
import subprocess
from pathlib import Path
from xml.parsers.expat import ExpatError

from app.tool_navigation.storage_usage_schemas import (
    StorageAnalyzer,
    StorageCapacity,
    StorageOpenReceipt,
    StorageShortcut,
    StorageUsageState,
)

BUNDLE_ID = "net.sourceforge.grandperspectiv"


class StorageUsageError(Exception):
    pass


def application_candidates() -> tuple[Path, ...]:
    return (
        Path("/Applications/GrandPerspective.app"),
        Path.home() / "Applications/GrandPerspective.app",
    )


def find_analyzer() -> tuple[Path | None, StorageAnalyzer]:
    for candidate in application_candidates():
        try:
            bundle = candidate.resolve(strict=True)
            with (bundle / "Contents/Info.plist").open("rb") as stream:
                info = plistlib.load(stream)
            if not isinstance(info, dict):
                continue
            version = info.get("CFBundleShortVersionString")
            executable = info.get("CFBundleExecutable")
            if (
                info.get("CFBundleIdentifier") != BUNDLE_ID
                or not isinstance(version, str)
                or not version.strip()
                or not isinstance(executable, str)
                or Path(executable).name != executable
            ):
                continue
            binary = bundle / "Contents/MacOS" / executable
            if binary.is_file() and os.access(binary, os.X_OK):
                return bundle, StorageAnalyzer(installed=True, version=version)
        except (OSError, ValueError, RuntimeError, plistlib.InvalidFileException, ExpatError):
            continue
    return None, StorageAnalyzer(installed=False)


def checked_directory(value: str) -> Path:
    if not value or "\0" in value or not Path(value).is_absolute():
        raise StorageUsageError("请选择有效的绝对目录路径")
    try:
        directory = Path(value).resolve(strict=True)
        if not stat.S_ISDIR(directory.stat().st_mode):
            raise StorageUsageError("所选路径不是目录，请重新选择")
        if not os.access(directory, os.R_OK | os.X_OK):
            raise StorageUsageError("没有访问所选目录的权限，请检查系统隐私设置")
        return directory
    except PermissionError as exc:
        raise StorageUsageError("没有访问所选目录的权限，请检查系统隐私设置") from exc
    except (OSError, ValueError, RuntimeError) as exc:
        raise StorageUsageError("目录不存在或已不可用，请重新选择") from exc


def read_storage_usage(directory: str | None = None) -> StorageUsageState:
    selected = checked_directory(directory if directory is not None else str(Path.home()))
    try:
        usage = shutil.disk_usage(selected)
    except OSError as exc:
        raise StorageUsageError("无法读取目录所在磁盘的容量，请刷新重试") from exc
    _, analyzer = find_analyzer()
    shortcuts = []
    for key, label, target in (
        ("home", "主目录", Path.home()),
        ("downloads", "下载", Path.home() / "Downloads"),
        ("applications", "应用程序", Path("/Applications")),
        ("startup", "启动磁盘", Path("/")),
    ):
        try:
            resolved = checked_directory(str(target))
            available = True
        except StorageUsageError:
            resolved, available = target, False
        shortcuts.append(
            StorageShortcut(id=key, label=label, directory=str(resolved), available=available)
        )
    return StorageUsageState(
        analyzer=analyzer,
        directory=str(selected),
        capacity=StorageCapacity(
            total_bytes=usage.total, used_bytes=usage.used, free_bytes=usage.free
        ),
        shortcuts=shortcuts,
    )


def open_storage_directory(directory: str, *, analyze: bool) -> StorageOpenReceipt:
    selected = checked_directory(directory)
    if analyze:
        application, _ = find_analyzer()
        if application is None:
            raise StorageUsageError("未检测到可用的 GrandPerspective，请安装后重新检测")
        arguments = ["/usr/bin/open", "-a", str(application), str(selected)]
    else:
        arguments = ["/usr/bin/open", "-b", "com.apple.finder", str(selected)]
    try:
        subprocess.run(
            arguments, check=True, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    except subprocess.TimeoutExpired as exc:
        raise StorageUsageError("打开请求超时，应用可能已经打开；请检查后再手动重试") from exc
    except (OSError, subprocess.CalledProcessError) as exc:
        raise StorageUsageError("无法打开应用或目录，请检查安装和目录权限后重试") from exc
    return StorageOpenReceipt(directory=str(selected))

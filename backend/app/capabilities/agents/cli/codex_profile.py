"""Private service login for Codex app-server."""

import os
import stat
from pathlib import Path

from .transport import CliError, environment

AUTH_ARGS = ("-c", 'cli_auth_credentials_store="file"')


class CodexLoginRequired(CliError):
    pass


def profile_path(runtime: Path) -> Path:
    return runtime / "profiles" / "codex-app-server"


def _private(path: Path, *, directory: bool):
    info = path.lstat()
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if (
        not kind(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o077
        or (not directory and info.st_nlink != 1)
    ):
        raise CliError("FPL Codex 专用登录目录或凭据权限不安全")


def profile_environment(profile: Path, *, require_auth=True):
    try:
        if profile != profile.resolve():
            raise CliError("FPL Codex 专用目录不能经过符号链接")
        _private(profile, directory=True)
        for name in ("config.toml", ".codex", "rules", "plugins", "AGENTS.md"):
            entry = profile / name
            if entry.exists() or entry.is_symlink():
                raise CliError("FPL Codex 专用目录包含外部配置、规则或工具")
        skills = profile / "skills"
        if skills.is_symlink() or (
            skills.exists()
            and (
                not skills.is_dir()
                or any(
                    entry.name != ".system" or not entry.is_dir() or entry.is_symlink()
                    for entry in skills.iterdir()
                )
            )
        ):
            raise CliError("FPL Codex 专用目录包含外部技能")
        auth = profile / "auth.json"
        if require_auth or auth.exists() or auth.is_symlink():
            _private(auth, directory=False)
    except FileNotFoundError:
        raise CodexLoginRequired("请在本机为 FPL 的 Codex 单独登录") from None
    return {**environment(), "CODEX_HOME": str(profile)}

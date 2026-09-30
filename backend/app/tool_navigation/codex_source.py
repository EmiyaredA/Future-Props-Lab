"""Manage the local Codex model source without handling provider credentials."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
import tomllib
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

MANAGED_PROVIDER = "fpl_custom"
_BACKUP_NAME = "config.toml.fpl-original"
_TOP_LEVEL_KEYS = {"model", "model_provider", "model_catalog_json"}
_TABLE = re.compile(r"^\s*\[{1,2}([^\]]+)\]{1,2}\s*(?:#.*)?$")
_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_MODEL_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
_WRITE_LOCK = threading.Lock()


class CodexSourceError(ValueError):
    pass


class CodexSourceConflict(CodexSourceError):
    pass


class CodexSourceState(BaseModel):
    config_path: str
    revision: str
    provider: str
    model: str
    base_url: str
    env_key: str
    managed: bool
    backup_available: bool


class CodexSourceUpdate(BaseModel):
    expected_revision: str = Field(min_length=1)
    source: str = Field(pattern=r"^(openai|custom)$")
    model: str = ""
    base_url: str = ""
    env_key: str = ""


class CodexSourceRestore(BaseModel):
    expected_revision: str = Field(min_length=1)


def _codex_home() -> Path:
    configured = os.environ.get("CODEX_HOME", "").strip()
    return (Path(configured).expanduser() if configured else Path.home() / ".codex").resolve()


def _paths() -> tuple[Path, Path]:
    home = _codex_home()
    return home / "config.toml", home / _BACKUP_NAME


def _read_config(path: Path) -> tuple[bytes, dict]:
    if path.is_symlink():
        raise CodexSourceError("Codex 配置文件是符号链接，无法安全修改")
    try:
        raw = path.read_bytes() if path.exists() else b""
        parsed = tomllib.loads(raw.decode("utf-8")) if raw else {}
    except (OSError, UnicodeError, tomllib.TOMLDecodeError) as exc:
        raise CodexSourceError("Codex 配置无法读取或不是有效 TOML") from exc
    return raw, parsed


def _revision(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest() if raw else "missing"


def read_codex_source() -> CodexSourceState:
    path, backup = _paths()
    raw, parsed = _read_config(path)
    provider = str(parsed.get("model_provider") or "openai")
    providers = parsed.get("model_providers") or {}
    definition = providers.get(provider, {}) if isinstance(providers, dict) else {}
    if not isinstance(definition, dict):
        definition = {}
    managed = provider == MANAGED_PROVIDER
    base_url = str(definition.get("base_url") or "") if managed else ""
    env_key = str(definition.get("env_key") or "") if managed else ""
    try:
        url = urlsplit(base_url)
        if url.username or url.password or url.query or url.fragment:
            base_url = ""
    except ValueError:
        base_url = ""
    if env_key and not _ENV_NAME.fullmatch(env_key):
        env_key = ""
    return CodexSourceState(
        config_path=str(path),
        revision=_revision(raw),
        provider=provider,
        model=str(parsed.get("model") or ""),
        base_url=base_url,
        env_key=env_key,
        managed=managed,
        backup_available=backup.is_file() and not backup.is_symlink(),
    )


def _without_managed_settings(text: str) -> list[str]:
    lines: list[str] = []
    in_top_level = True
    skip_table = False
    for line in text.splitlines():
        table = _TABLE.match(line)
        if table:
            in_top_level = False
            name = table.group(1).strip().strip('"').strip("'")
            skip_table = name == f"model_providers.{MANAGED_PROVIDER}" or name.startswith(
                f"model_providers.{MANAGED_PROVIDER}."
            )
        if skip_table:
            continue
        if in_top_level and "=" in line and not line.lstrip().startswith("#"):
            key = line.split("=", 1)[0].strip().strip('"').strip("'")
            if key in _TOP_LEVEL_KEYS:
                continue
        lines.append(line)
    return lines


def _validate_custom(body: CodexSourceUpdate) -> None:
    if not _MODEL_NAME.fullmatch(body.model.strip()):
        raise CodexSourceError("模型 ID 只能包含字母、数字及 . _ : / -，最长 128 字符")
    try:
        url = urlsplit(body.base_url.strip())
        _ = url.port
    except ValueError as exc:
        raise CodexSourceError("API 基础地址格式无效") from exc
    if (
        url.scheme not in {"http", "https"}
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or any(char.isspace() for char in body.base_url.strip())
    ):
        raise CodexSourceError("请输入不含账号、查询参数和片段的 HTTP(S) API 基础地址")
    if body.env_key.strip() and not _ENV_NAME.fullmatch(body.env_key.strip()):
        raise CodexSourceError("环境变量名只能包含字母、数字和下划线，且不能以数字开头")


def _atomic_write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def _checked_current(expected_revision: str) -> tuple[Path, Path, bytes]:
    path, backup = _paths()
    raw, _ = _read_config(path)
    if _revision(raw) != expected_revision:
        raise CodexSourceConflict("Codex 配置已被其他程序修改，请刷新后重试")
    return path, backup, raw


def _update_codex_source(body: CodexSourceUpdate) -> CodexSourceState:
    path, backup, raw = _checked_current(body.expected_revision)
    if b'"""' in raw or b"'''" in raw:
        raise CodexSourceError("配置包含多行 TOML 字符串，请手工编辑后再使用此工具")
    if backup.is_symlink():
        raise CodexSourceError("Codex 备份路径是符号链接，无法安全写入")
    if body.source == "custom":
        _validate_custom(body)
    lines = _without_managed_settings(raw.decode("utf-8"))
    if body.source == "custom":
        head = [
            f"model = {json.dumps(body.model.strip(), ensure_ascii=False)}",
            f'model_provider = "{MANAGED_PROVIDER}"',
        ]
        tail = [
            f"[model_providers.{MANAGED_PROVIDER}]",
            'name = "Future Props Lab custom"',
            f"base_url = {json.dumps(body.base_url.strip().rstrip('/'), ensure_ascii=False)}",
            'wire_api = "responses"',
            "supports_websockets = false",
        ]
        if body.env_key.strip():
            tail.append(f"env_key = {json.dumps(body.env_key.strip())}")
        payload = "\n".join([*head, "", *lines, "", *tail]).strip() + "\n"
    else:
        payload = "\n".join(['model_provider = "openai"', "", *lines]).strip() + "\n"
    try:
        tomllib.loads(payload)
    except tomllib.TOMLDecodeError as exc:
        raise CodexSourceError("修改后的 Codex 配置无效，未写入文件") from exc
    if not backup.exists():
        _atomic_write(backup, raw)
    _atomic_write(path, payload.encode("utf-8"))
    return read_codex_source()


def _restore_codex_source(body: CodexSourceRestore) -> CodexSourceState:
    path, backup, _ = _checked_current(body.expected_revision)
    if not backup.is_file() or backup.is_symlink():
        raise CodexSourceError("没有可用的原始 Codex 配置备份")
    original, _ = _read_config(backup)
    _atomic_write(path, original)
    backup.unlink()
    return read_codex_source()


def update_codex_source(body: CodexSourceUpdate) -> CodexSourceState:
    with _WRITE_LOCK:
        return _update_codex_source(body)


def restore_codex_source(body: CodexSourceRestore) -> CodexSourceState:
    with _WRITE_LOCK:
        return _restore_codex_source(body)

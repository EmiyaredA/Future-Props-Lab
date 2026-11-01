"""Bounded reads of complete native records, including concatenated Zstandard frames."""

from __future__ import annotations

import hashlib
import io
import json
import os
import stat
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path

from .contracts import ReadBatch, SessionInfo

MAX_CHUNK = 4 * 1024 * 1024
MAX_RECORD = 64 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024
SKIP_DIRS = {"node_modules", ".git", "skills", "plugins", "cache", "Cache", "attachments"}


def safe_path(root: str, relative: str) -> Path:
    base = Path(root).resolve(strict=True)
    path = base / relative
    if Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError("来源路径越界")
    current = base
    for part in Path(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("不读取符号链接来源")
    if not path.resolve(strict=True).is_relative_to(base):
        raise ValueError("来源路径越界")
    return path


def open_regular(root: str, relative: str):
    """Resolve each component through an open directory descriptor without links."""
    if Path(relative).is_absolute() or ".." in Path(relative).parts or not relative:
        raise ValueError("来源路径越界")
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parts = Path(relative).parts
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            os.close(fd)
            raise ValueError("只读取普通来源文件")
        return os.fdopen(fd, "rb")
    finally:
        os.close(directory)


def discover_files(root: str, suffixes: tuple[str, ...], *, codex=False) -> list[str]:
    base = Path(root)
    if not base.is_dir():
        raise FileNotFoundError("来源目录不可用")
    found = []
    for directory, dirs, files in os.walk(base, followlinks=False):
        dirs[:] = sorted(
            d for d in dirs if d not in SKIP_DIRS and not (Path(directory) / d).is_symlink()
        )
        native_home = (
            codex
            and Path(directory) == base
            and any((base / name).is_dir() for name in ("sessions", "archived_sessions"))
        )
        if native_home:
            dirs[:] = [d for d in dirs if d in {"sessions", "archived_sessions"}]
        for name in sorted(files):
            if native_home or (codex and name in {"session_index.jsonl", "history.jsonl"}):
                # The home also contains session-name indexes and CLI prompt
                # history. They are not conversation rollouts or message sources.
                continue
            path = Path(directory) / name
            if name.endswith(suffixes) and not path.is_symlink():
                found.append(str(path.relative_to(base)))
                if len(found) >= 20000:
                    raise ValueError("来源超过 20000 个记录文件，请缩小读取范围")
    # Recent records become available before a large cold archive is indexed.
    return sorted(found, key=lambda item: (base / item).stat().st_mtime_ns, reverse=True)


def codex_titles(root: str) -> dict[str, str]:
    """Optional native name metadata stays inside the explicitly authorized root."""
    try:
        with open_regular(root, "session_index.jsonl") as stream:
            data = stream.read(MAX_CHUNK + 1)
    except OSError:
        return {}
    if len(data) > MAX_CHUNK:
        return {}
    titles = {}
    for line in data.splitlines(keepends=True):
        if not line.endswith(b"\n"):
            continue
        try:
            item = json.loads(line)
        except (ValueError, UnicodeError):
            continue
        if not isinstance(item, dict):
            continue
        identity, name = item.get("id"), item.get("thread_name")
        if isinstance(identity, str) and isinstance(name, str) and name.strip():
            titles[identity] = name.strip()[:120]
    return titles


def read_records(root: str, locator: str, checkpoint: dict):
    path = safe_path(root, locator)
    with open_regular(root, locator) as raw:
        stat = os.fstat(raw.fileno())
        identity = f"{stat.st_dev}:{stat.st_ino}"
        fingerprint = f"{stat.st_size}:{stat.st_mtime_ns}"
        prior_prefix = int(checkpoint.get("prefix_size", 0))
        prefix = raw.read(max(prior_prefix, min(stat.st_size, 4096)))
        raw.seek(0)
        old_offset = int(checkpoint.get("offset", 0))
        reset = bool(checkpoint) and (
            checkpoint.get("identity") != identity
            or stat.st_size < checkpoint.get("physical_size", 0)
            or (
                prior_prefix
                and hashlib.sha256(prefix[:prior_prefix]).hexdigest()
                != checkpoint.get("prefix_hash")
            )
        )
        if (
            not reset
            and checkpoint.get("fingerprint") == fingerprint
            and checkpoint.get("complete")
        ):
            return [], checkpoint, False, True
        # Codex also stores Zstandard frames under the original .jsonl name.
        # Detect the native bytes before decoding, without rewriting the source.
        compressed = prefix.startswith(b"\x28\xb5\x2f\xfd") or path.name.endswith((".zstd", ".zst"))
        stream = raw
        if compressed:
            import zstandard

            stream = io.BufferedReader(zstandard.ZstdDecompressor().stream_reader(raw))
        offset = 0 if reset else old_offset
        if compressed and offset > MAX_EXPANDED:
            raise ValueError("压缩来源记录展开体积超过限制")
        if compressed:
            remaining = offset
            while remaining:
                chunk = stream.read(min(remaining, MAX_CHUNK))
                if not chunk:
                    raise ValueError("压缩来源已重写，请重新扫描")
                remaining -= len(chunk)
        else:
            stream.seek(offset)
        records = []
        consumed = 0
        while consumed < MAX_CHUNK and len(records) < 2000:
            start = offset
            line = stream.readline(MAX_RECORD + 1)
            if len(line) > MAX_RECORD:
                raise ValueError("来源单条记录超过 64 MiB")
            if not line or not line.endswith(b"\n"):
                break
            offset += len(line)
            consumed += len(line)
            try:
                value = json.loads(line)
            except (ValueError, UnicodeError) as exc:
                raise ValueError("来源含无效的完整 JSON 记录") from exc
            if isinstance(value, dict):
                records.append((start, value))
        complete = consumed < MAX_CHUNK and len(records) < 2000
        updated = {
            "identity": identity,
            "fingerprint": fingerprint,
            "offset": offset,
            "physical_size": stat.st_size,
            "complete": complete,
            "prefix_size": len(prefix),
            "prefix_hash": hashlib.sha256(prefix).hexdigest(),
        }
        return records, updated, reset, complete


class JsonlAdapter:
    def __init__(self, agent_id: str, parser):
        self.agent_id = agent_id
        self.parser = parser
        self.titles: dict[str, str] = {}

    def get_capabilities(self):
        return {"browse": True, "follow": True, "send": False, "mode": "log_follow"}

    def discover(self, root):
        if self.agent_id == "codex":
            self.titles = codex_titles(root)
        return discover_files(
            root, (".jsonl", ".jsonl.zstd", ".jsonl.zst"), codex=self.agent_id == "codex"
        )

    def read_history(self, root, locator, checkpoint):
        records, updated, reset, complete = read_records(root, locator, checkpoint)
        info = SessionInfo(**deepcopy({} if reset else checkpoint.get("info", {})))
        entries = []
        for ordinal, record in records:
            entries.extend(self.parser(record, ordinal, info, locator))
        if info.native_id in self.titles:
            info.title = self.titles[info.native_id]
        if not info.native_id and records:
            raise ValueError("未识别到原生会话头；来源格式不支持")
        info.archived = info.archived or (
            self.agent_id == "codex" and "archived_sessions" in (Path(root) / locator).parts
        )
        updated = {**updated, "info": asdict(info)}
        return ReadBatch(info, entries, updated, reset, complete)

    def watch(self, root, locator, checkpoint):
        return self.read_history(root, locator, checkpoint)

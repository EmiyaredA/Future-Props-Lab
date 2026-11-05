"""Atomically pin a verified Integration archive to an owned conversation."""

import hashlib
import json
import os
import re
import stat
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import BadZipFile, ZipFile

import httpx
from anyio.to_thread import run_sync

from studio.apps.amadeus.storage.skill_files import skill_path_parts
from studio.contracts.amadeus.amadeus_skills import HEADER as SKILL_HEADER
from studio.contracts.amadeus.amadeus_skills import PURPOSE, SKILL_SOURCE, VERSION, SkillPin
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable


def pinned_version(root):
    if not root.exists():
        return None
    if root.is_symlink() or not root.is_dir():
        raise OperationError("会话 Skill 目录不安全", "skill_unavailable", 409)
    pinned = list(root.iterdir())
    if not pinned:
        return None
    if (
        len(pinned) != 1
        or not pinned[0].is_dir()
        or pinned[0].is_symlink()
        or not re.fullmatch(VERSION, pinned[0].name)
    ):
        raise OperationError("会话 Skill 版本不明确", "skill_unavailable", 409)
    return pinned[0]


def instructions(root, name, version):
    markdown = next(
        (path for path in sorted(root.iterdir()) if path.name.casefold() == "skill.md"), None
    )
    if markdown is None or markdown.is_symlink() or not markdown.is_file():
        raise OperationError("Skill 缺少 SKILL.md", "skill_unavailable", 409)
    with markdown.open(encoding="utf-8") as source:
        content = source.read(50_001)
    if len(content) > 50_000:
        raise OperationError("Skill 指令过长", "skill_unavailable", 409)
    return {"name": name, "version": version, "content": content, "path": markdown.name}


def extract(archive_file, directory, pin):
    directory.mkdir(mode=0o700)
    seen = set()
    with ZipFile(archive_file) as archive:
        files = archive.infolist()
        if (
            len(files) != pin.file_count
            or sum(item.file_size for item in files) != pin.expanded_bytes
        ):
            raise ValueError("Skill 文件清单与描述不符")
        for item in files:
            path = directory.joinpath(*skill_path_parts(item.filename))
            name = item.filename.casefold()
            mode = stat.S_IFMT(item.external_attr >> 16)
            if name in seen or item.is_dir() or mode not in {0, stat.S_IFREG}:
                raise ValueError("Skill 文件不安全")
            seen.add(name)
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with archive.open(item) as source, path.open("xb") as target:
                remaining = item.file_size
                while data := source.read(1024 * 1024):
                    remaining -= len(data)
                    if remaining < 0:
                        raise ValueError("Skill 文件大小不符")
                    target.write(data)
                if remaining:
                    raise ValueError("Skill 文件内容不完整")
                target.flush()
                os.fsync(target.fileno())
    result = instructions(directory, pin.name, pin.version)
    for root, _, _ in os.walk(directory, topdown=False):
        sync_directory(root)
    return result


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class SkillSource:
    def __init__(self, capabilities, assertion, source_path, skill_id):
        self.capabilities, self.assertion = capabilities, assertion
        self.source_path, self.skill_id = source_path, skill_id

    def grant(self, kind):
        return RequestGrant(
            "amadeus",
            PURPOSE,
            "POST",
            self.source_path,
            "integrations",
            "GET",
            f"{SKILL_SOURCE}/{self.skill_id}/{kind}",
        )

    @asynccontextmanager
    async def fetch(self, kind):
        grant = self.grant(kind)
        try:
            token = await self.capabilities.authorize_request(self.assertion, grant)
            async with self.capabilities.client.stream(
                "GET",
                "http://integrations:8080" + grant.target_path,
                headers={HEADER: token, "Accept-Encoding": "identity"},
                timeout=httpx.Timeout(120, connect=5),
            ) as response:
                if response.status_code in {401, 403, 404, 409}:
                    errors = {
                        401: ("studio_auth_required", "Session 已失效"),
                        403: ("insufficient_permission", "Skill 授权不可用"),
                        404: ("not_found", "Skill 不存在"),
                        409: ("skill_unavailable", "Skill 尚未启用或版本不可用"),
                    }
                    code, message = errors[response.status_code]
                    raise OperationError(message, code, response.status_code)
                response.raise_for_status()
                yield response
        except CapabilityDenied as exc:
            raise OperationError("Skill 授权不可用", "insufficient_permission", exc.status) from exc
        except (CapabilityUnavailable, httpx.HTTPError) as exc:
            raise OperationError("Skill 来源暂不可用", "skill_unavailable", 503) from exc

    async def metadata(self):
        async with self.fetch("metadata") as response:
            payload = bytearray()
            async for part in response.aiter_bytes():
                if len(payload) + len(part) > 4096:
                    raise ValueError("Skill 信息过大")
                payload.extend(part)
            name = json.loads(payload)["name"]
            if not isinstance(name, str) or not 1 <= len(name) <= 120:
                raise ValueError("Skill 名称无效")
            return name

    async def download(self, output):
        async with self.fetch("archive") as response:
            pin = SkillPin.from_header(response.headers.get(SKILL_HEADER, ""))
            if (
                response.headers.get("Content-Length") != str(pin.archive_bytes)
                or response.headers.get("Content-Encoding", "identity") != "identity"
            ):
                raise ValueError("Skill 传输描述无效")
            digest = hashlib.sha256()
            size = 0
            async for chunk in response.aiter_raw():
                size += len(chunk)
                if size > pin.archive_bytes:
                    raise ValueError("Skill 压缩包过大")
                digest.update(chunk)
                await run_sync(output.write, chunk)
            if size != pin.archive_bytes or digest.hexdigest() != pin.archive_sha256:
                raise ValueError("Skill 压缩包摘要或长度不符")
            return pin


async def load_pin(root, source):
    try:
        pinned = await run_sync(pinned_version, root)
        if pinned is not None:
            name = await source.metadata()
            return await run_sync(instructions, pinned, name, pinned.name)
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with TemporaryDirectory(prefix=".amadeus-pin-", dir=root.parent) as staging:
            pending = Path(staging)
            with (pending / "source.zip").open("w+b") as output:
                pin = await source.download(output)
                output.flush()
                output.seek(0)
                directory = pending / "files"
                result = await run_sync(extract, output, directory, pin)
            await source.metadata()
            os.rename(directory, root / pin.version)
            for path in (root, root.parent, root.parent.parent):
                sync_directory(path)
            return result
    except (BadZipFile, OSError, ValueError, KeyError, TypeError) as exc:
        raise OperationError("Skill 快照不可用", "skill_unavailable", 409) from exc

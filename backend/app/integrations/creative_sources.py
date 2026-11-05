"""Export only Creative-safe snapshots of an account's own Integrations."""

import asyncio
import hashlib
import io
import zipfile
from pathlib import Path

from sqlalchemy import select

from app.integrations.models import (
    McpIntegration,
    SkillIntegration,
    SkillVersion,
    ToolApiIntegration,
)
from studio.config.settings import get_settings
from studio.contracts.creative_workshop.creative_source_snapshot import CreativeSource


def skill_archive(root: Path, maximum: int, expanded_limit: int, file_limit: int) -> bytes:
    if root.is_symlink() or not root.is_dir() or root.resolve() != root:
        raise ValueError("Skill 来源路径不可用")
    files, total = [], 0
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("Skill 来源不能包含符号链接")
        if not path.is_file():
            continue
        total += path.stat().st_size
        files.append(path)
        if len(files) > file_limit or total > expanded_limit:
            raise ValueError("Skill 来源超过文件数量或展开尺寸限制")
    if not files or not (root / "SKILL.md").is_file():
        raise ValueError("Skill 来源缺少 SKILL.md")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(root).as_posix())
            if buffer.tell() > maximum:
                raise ValueError("Skill 来源超过归档尺寸限制")
    if buffer.tell() > maximum:
        raise ValueError("Skill 来源超过归档尺寸限制")
    return buffer.getvalue()


class IntegrationCreativeSources:
    def __init__(self, session, *, settings=None):
        self.session = session
        self.settings = settings

    async def snapshot(self, *, owner: str, kind: str, source_id: str) -> CreativeSource | None:
        if kind == "tool_api":
            row = await self.session.get(ToolApiIntegration, source_id)
            if row is None or row.owner_user_id != owner:
                return None
            return CreativeSource(
                row.name,
                row.description,
                {
                    "method": row.method,
                    "url": row.url,
                    "auth_kind": row.auth_kind,
                    "auth_header_name": row.auth_header_name,
                    "parameters_schema": row.parameters_schema,
                    "query_template": row.query_template,
                    "body_template": row.body_template,
                },
            )
        if kind == "mcp":
            row = await self.session.get(McpIntegration, source_id)
            if row is None or row.owner_user_id != owner:
                return None
            manifest = (
                {"transport": "streamable_http", "url": row.url}
                if row.transport == "streamable_http"
                else {"transport": "stdio", "command_hint": "请填写本机命令"}
            )
            return CreativeSource(row.name, row.description, manifest)
        if kind != "skill":
            return None
        row = await self.session.get(SkillIntegration, source_id)
        if row is None or row.owner_user_id != owner:
            return None
        version = await self.session.scalar(
            select(SkillVersion).where(
                SkillVersion.skill_id == row.id, SkillVersion.version == row.default_version
            )
        )
        title, summary, identity, selected = row.name, row.description, row.id, row.default_version
        if version is None:
            return CreativeSource(title, summary, {})
        if any(
            not part or part in {".", ".."} or Path(part).name != part
            for part in (identity, selected)
        ):
            raise ValueError("Skill 来源标识无效")
        settings = self.settings or get_settings()
        settings.account_path(owner)  # validate the authenticated account component
        root = (
            settings.runtime_path
            / "accounts"
            / owner
            / "integrations"
            / "skills"
            / identity
            / selected
        )
        await self.session.rollback()
        body = await asyncio.to_thread(
            skill_archive,
            root,
            settings.fpl_skill_archive_max_bytes,
            settings.fpl_skill_expanded_max_bytes,
            settings.fpl_skill_max_files,
        )
        return CreativeSource(title, summary, {}, body, hashlib.sha256(body).hexdigest())

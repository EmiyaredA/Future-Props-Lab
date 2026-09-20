"""Pin an enabled integration skill into a conversation's work directory."""

from __future__ import annotations

import asyncio
import shutil

from app.console.amadeus.files import work_root
from app.integrations.skills.catalog import SkillCatalog
from app.runtime.operation_receipts import OperationError


async def load_skill(
    session, workspace_id: str, conversation_id: str, skill_id: str
) -> dict[str, str]:
    catalog = SkillCatalog(session, workspace_id)
    try:
        skill = await catalog.get(skill_id)
    except Exception as exc:
        raise OperationError("Skill 不存在", "not_found", 404) from exc
    if not skill.enabled:
        raise OperationError("Skill 尚未启用", "skill_unavailable", 409)
    skill_root = work_root(workspace_id, conversation_id) / "skills" / skill_id
    if skill_root.is_symlink():
        raise OperationError("会话目录不安全", "skill_unavailable", 409)
    pinned = [path for path in skill_root.iterdir() if path.is_dir()] if skill_root.is_dir() else []
    if len(pinned) > 1 or any(path.is_symlink() for path in pinned):
        raise OperationError("会话 Skill 版本不明确", "skill_unavailable", 409)
    version = pinned[0].name if pinned else (skill.default_version or skill.latest_version)
    destination = skill_root / version
    if not pinned:
        versions = await catalog.versions(skill_id)
        if version not in {item.version for item in versions}:
            raise OperationError("Skill 版本不可用", "skill_unavailable", 409)
        source = catalog.storage.final_path(skill_id, version)
        if not source.is_dir() or source.is_symlink():
            raise OperationError("Skill 文件不可用", "skill_unavailable", 409)
        if any(path.is_symlink() for path in source.rglob("*")):
            raise OperationError("Skill 含符号链接", "skill_unavailable", 409)
    parents = (destination.parent.parent, destination.parent, destination)
    if any(path.is_symlink() for path in parents):
        raise OperationError("会话目录不安全", "skill_unavailable", 409)
    await session.rollback()
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        await asyncio.to_thread(shutil.copytree, source, destination, symlinks=False)
    if any(path.is_symlink() for path in destination.rglob("*")):
        raise OperationError("会话 Skill 文件不安全", "skill_unavailable", 409)
    files = sorted(destination.rglob("SKILL.md"))
    if not files:
        raise OperationError("Skill 缺少 SKILL.md", "skill_unavailable", 409)
    content = files[0].read_text(encoding="utf-8")
    if len(content) > 50_000:
        raise OperationError("Skill 指令过长", "skill_unavailable", 409)
    return {
        "name": skill.name,
        "version": version,
        "content": content,
        "path": str(files[0].relative_to(destination)),
    }

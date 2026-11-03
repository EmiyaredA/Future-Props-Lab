"""Resolve a published Skill only within its originating account's release directory."""

import asyncio
import re
from pathlib import Path

from fpl_runtime.skill_tree import skill_tree_sha256


async def published_skill_tree(root: Path, owner: str, release_id: str, relative: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,36}", owner) or not re.fullmatch(
        r"[A-Za-z0-9_-]{1,100}", release_id
    ):
        raise ValueError("Skill 发布归属无效")
    expected = f"creative-workshop/skill-releases/{release_id}"
    if relative != expected:
        raise ValueError("Skill 发布路径无效")
    root = Path(root).resolve()
    path = root
    for part in ("accounts", owner, *Path(expected).parts):
        path = path / part
        if path.is_symlink():
            raise ValueError("Skill 发布路径不能包含符号链接")
    return await asyncio.to_thread(
        skill_tree_sha256, path, max_files=10000, max_bytes=1024 * 1024 * 1024
    )

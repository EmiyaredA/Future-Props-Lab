"""Inventory the expanded Skill originals without using legacy absolute paths."""

from studio.contracts.integrations.skill_migration import SkillFile
from studio.runtime.files.migration_files import checked_path, inspect_blob, inventory_directory


def version_directory(root, owner, skill, version):
    return checked_path(root, "accounts", owner, "integrations", "skills", skill, version)


def checked_member(directory, value):
    parts = value.split("/")
    if parts[0].endswith(":") or "\x00" in value:
        raise ValueError("Skill 文件路径无效")
    return checked_path(directory, *parts)


def inventory_version(directory, *, file_count, expanded_bytes, complete):
    files = []
    folded = set()
    directories = [directory]
    while directories:
        base = directories.pop()
        for path in inventory_directory(base):
            name = path.relative_to(directory).as_posix()
            checked_member(directory, name)
            if path.is_dir():
                directories.append(path)
                continue
            if name.casefold() in folded:
                raise ValueError("Skill 文件路径存在大小写冲突")
            folded.add(name.casefold())
            size, digest = inspect_blob(path, allow_empty=True, maximum=expanded_bytes)
            files.append(SkillFile(path=name, size=size, sha256=digest))
            if len(files) > file_count:
                raise ValueError("Skill 文件数超过版本记录")
    size = sum(file.size for file in files)
    if size > expanded_bytes or (complete and (size != expanded_bytes or len(files) != file_count)):
        raise ValueError("Skill 文件数量或字节数与版本记录不匹配")
    if complete and "skill.md" not in folded:
        raise ValueError("Skill 缺少根目录 SKILL.md")
    return sorted(files, key=lambda file: file.path)

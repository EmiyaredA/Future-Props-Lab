#!/usr/bin/env python3
"""Validate future-props-lab-automation skill package structure."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
TRIGGER_RE = re.compile(r"(Use when|用于|在需要|当.{0,24}时)", re.I)


def parse_frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---\n"):
        raise ValueError("missing YAML frontmatter")
    end = text.find("\n---\n", 4)
    if end < 0:
        raise ValueError("unclosed YAML frontmatter")
    block = text[4:end]
    data: dict[str, str] = {}
    key: str | None = None
    parts: list[str] = []
    for line in block.splitlines():
        if key and (line.startswith(" ") or line.startswith("\t")):
            parts.append(line.strip())
            continue
        if key is not None:
            data[key] = " ".join(parts).strip()
            key = None
            parts = []
        if ":" not in line:
            continue
        raw_key, raw_val = line.split(":", 1)
        raw_key = raw_key.strip()
        raw_val = raw_val.strip()
        if raw_val in (">", "|", ""):
            key = raw_key
            parts = []
        else:
            data[raw_key] = raw_val
    if key is not None:
        data[key] = " ".join(parts).strip()
    return data


def validate_skill(path: Path, *, is_pack_root: bool) -> list[str]:
    errors: list[str] = []
    text = path.read_text(encoding="utf-8")
    try:
        meta = parse_frontmatter(text)
    except ValueError as exc:
        return [f"{path}: {exc}"]

    name = meta.get("name", "")
    description = meta.get("description", "")
    parent = path.parent.name

    if not name:
        errors.append(f"{path}: missing name")
    elif not NAME_RE.fullmatch(name):
        errors.append(f"{path}: invalid name {name!r}")
    elif name != parent:
        errors.append(f"{path}: name {name!r} != directory {parent!r}")

    if not description:
        errors.append(f"{path}: missing description")
    elif not TRIGGER_RE.search(description):
        errors.append(f"{path}: description missing trigger phrase (Use when / 用于 / …)")

    if is_pack_root:
        if "## 路由表" not in text:
            errors.append(f"{path}: pack root missing ## 路由表")
    else:
        if "## 前置（单独安装时必做）" not in text:
            errors.append(f"{path}: missing ## 前置（单独安装时必做）")
        if "## 最小可运行示例" not in text:
            errors.append(f"{path}: missing ## 最小可运行示例")
        if "```" not in text:
            errors.append(f"{path}: missing fenced example")

    return errors


def main() -> int:
    skills = [ROOT / "SKILL.md", *sorted((ROOT / "skills").rglob("SKILL.md"))]
    if not skills[0].is_file():
        print(f"missing pack root: {skills[0]}", file=sys.stderr)
        return 1

    errors: list[str] = []
    for path in skills:
        errors.extend(validate_skill(path, is_pack_root=path.parent == ROOT))

    leaf_names = [p.parent.name for p in skills[1:]]
    dupes = sorted({n for n in leaf_names if leaf_names.count(n) > 1})
    if dupes:
        errors.append(f"duplicate leaf directory names: {', '.join(dupes)}")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        print(f"FAIL: {len(errors)} issue(s)", file=sys.stderr)
        return 1

    print(f"OK: {len(skills)} skills ({len(skills) - 1} leaves + pack root)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

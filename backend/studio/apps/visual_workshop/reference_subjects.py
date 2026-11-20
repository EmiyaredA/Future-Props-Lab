"""Stable image-to-tracking-target bindings, independent of provider execution."""

import re


def clean_subjects(value: dict[str, str] | None) -> dict[str, str] | None:
    if value is None:
        return None
    cleaned = {}
    for key, subject in value.items():
        if not re.fullmatch(r"(?:asset|edge):[A-Za-z0-9_-]{1,100}", key):
            raise ValueError("追踪对象须关联有效的图片或输入连线")
        subject = subject.strip()
        if (
            len(subject) > 160
            or not re.fullmatch(r"[A-Za-z0-9 '\-]+", subject)
            or not re.search(r"[A-Za-z]", subject)
        ):
            raise ValueError("追踪对象请填写 1 至 160 个英文字符")
        cleaned[key] = subject
    return cleaned


def compile_subjects(subjects, images, snapshot):
    """Deduped image order is authoritative; linked identities survive output changes."""
    targets = []
    for identity in images:
        keys = [f"edge:{item['edge_id']}" for item in snapshot if item.get("asset_id") == identity]
        keys.append(f"asset:{identity}")
        target = next((subjects[key] for key in keys if subjects.get(key)), None)
        if target:
            targets.append(target)
    return ", ".join(targets)


def order_references(order, images, snapshot):
    linked = {f"edge:{item['edge_id']}": item.get("asset_id") for item in snapshot}
    by_key = {**{f"asset:{identity}": identity for identity in images}, **linked}
    return list(
        dict.fromkeys(
            [
                *(by_key[key] for key in order or [] if by_key.get(key) in images),
                *images,
            ]
        )
    )

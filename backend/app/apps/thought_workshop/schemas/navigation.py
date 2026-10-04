"""Pure navigation-block contract; target metadata is resolved under access control."""

import re


def validate_navigation(kind: str, values: dict) -> None:
    if kind == "documentDirectory":
        if values.get("style", "list") not in {"list", "cards"}:
            raise ValueError("目录展示方式无效")
        parent = values.get("parentId")
        if parent is not None and (
            not isinstance(parent, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", parent)
        ):
            raise ValueError("父文档标识无效")
        return
    if values.get("style", "standard") not in {"standard", "featured"}:
        raise ValueError("文档卡片样式无效")
    if not isinstance(values.get("eyebrow", ""), str) or len(values.get("eyebrow", "")) > 240:
        raise ValueError("引导文字无效")
    if values.get("kind", "note") not in {"note", "official"}:
        raise ValueError("文档卡片类型无效")
    if values.get("kind", "note") == "note":
        target = values.get("noteId")
        if (
            values.get("libraryId")
            or values.get("documentId")
            or (
                target is not None
                and (
                    not isinstance(target, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,36}", target)
                )
            )
        ):
            raise ValueError("文档卡片标识无效")
    elif values.get("noteId") or any(
        not isinstance(values.get(key), str) or not re.fullmatch(r"[a-z0-9-]{1,100}", values[key])
        for key in ("libraryId", "documentId")
    ):
        raise ValueError("官方卡片标识无效")

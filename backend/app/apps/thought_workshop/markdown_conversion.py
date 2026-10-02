"""Controlled Markdown conversion; no HTML execution or remote asset fetching."""

import json
import re

import mistune

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.schemas.canvas import canvas_assets, remap_canvas, validate_canvas
from app.apps.thought_workshop.schemas.document import safe_link, validate_document


def parse_markdown(text, assets):
    warnings = set()
    parser = mistune.create_markdown(
        renderer="ast", plugins=["table", "strikethrough", "task_lists", "math"]
    )

    def convert(token, marks=()):
        kind, attrs = token["type"], token.get("attrs", {})
        children = token.get("children", [])
        if kind == "blank_line":
            return []
        if kind in {"text", "codespan", "inline_html", "block_html", "softbreak"}:
            raw = "\n" if kind == "softbreak" else token.get("raw", "")
            if not raw:
                return []
            if "html" in kind:
                warnings.add("原始 HTML 作为普通文字保留。")
            applied = [*marks, *([{"type": "code"}] if kind == "codespan" else [])]
            node = {"type": "text", "text": raw, **({"marks": applied} if applied else {})}
            return [{"type": "paragraph", "content": [node]}] if kind == "block_html" else [node]
        if kind in {"strong", "emphasis", "strikethrough", "link"}:
            mark = {
                "type": {
                    "strong": "bold",
                    "emphasis": "italic",
                    "strikethrough": "strike",
                    "link": "link",
                }[kind]
            }
            if kind == "link":
                href = attrs.get("url", "")
                if href in assets:
                    asset = assets[href]
                    return [
                        {
                            "type": "attachment",
                            "attrs": {
                                "assetId": asset.id,
                                "filename": asset.original_filename,
                                "mimeType": asset.mime_type,
                                "byteSize": asset.byte_size,
                            },
                        }
                    ]
                if not safe_link(href):
                    warnings.add("不支持的链接地址已去除。")
                    return [node for child in children for node in convert(child, marks)]
                mark["attrs"] = {"href": href}
            return [node for child in children for node in convert(child, (*marks, mark))]
        if kind == "image":
            asset = assets.get(attrs.get("url"))
            if asset is None or asset.media_kind != "image":
                raise ThoughtError("Markdown 图片必须通过 assets 映射到当前文件库图片")
            return [
                {
                    "type": "image",
                    "attrs": {
                        "assetId": asset.id,
                        "alt": "".join(child.get("raw", "") for child in children),
                    },
                }
            ]
        if kind in {"inline_math", "block_math"}:
            return [
                {
                    "type": "inlineMath" if kind == "inline_math" else "blockMath",
                    "attrs": {"latex": token["raw"]},
                }
            ]
        if kind == "block_code":
            language = attrs.get("info", "").split(" ")[0]
            if language == "fpl-canvas":
                try:
                    scene = validate_canvas(json.loads(token["raw"]))
                    mapping = {
                        path: assets[path].id
                        for path in canvas_assets(scene)
                        if path in assets and assets[path].media_kind == "image"
                    }
                    if set(mapping) != canvas_assets(scene):
                        raise ValueError("画板引用的图片缺失")
                    return [{"type": "canvas", "attrs": {"scene": remap_canvas(scene, mapping)}}]
                except (ValueError, KeyError, TypeError) as exc:
                    raise ThoughtError("画板数据或图片引用无效") from exc
            if language == "mermaid":
                return [{"type": "mermaid", "attrs": {"source": token["raw"].rstrip()}}]
            return [
                {
                    "type": "codeBlock",
                    "attrs": {"language": language},
                    "content": [{"type": "text", "text": token["raw"]}] if token["raw"] else [],
                }
            ]
        if kind == "thematic_break":
            return [{"type": "horizontalRule"}]
        if kind == "linebreak":
            return [{"type": "hardBreak"}]
        content = [node for child in children for node in convert(child, marks)]
        if kind in {"paragraph", "block_text", "heading"}:
            # File nodes are blocks in the editor, including inline Markdown images/attachments.
            result, inline = [], []
            for node in content:
                if node["type"] in {"image", "attachment"}:
                    if inline:
                        result.append({"type": "paragraph", "content": inline})
                        inline = []
                    result.append(node)
                else:
                    inline.append(node)
            if inline or not result:
                result.append(
                    {
                        "type": "heading" if kind == "heading" else "paragraph",
                        "content": inline,
                        **({"attrs": {"level": attrs["level"]}} if kind == "heading" else {}),
                    }
                )
            return result
        if kind == "list":
            task = any(node["type"] == "taskItem" for node in content)
            if task:
                content = [
                    {
                        **node,
                        "type": "taskItem",
                        "attrs": {"checked": node.get("attrs", {}).get("checked", False)},
                    }
                    for node in content
                ]
            return [
                {
                    "type": "taskList"
                    if task
                    else "orderedList"
                    if attrs.get("ordered")
                    else "bulletList",
                    "content": content,
                    **(
                        {"attrs": {"start": attrs.get("start", 1)}}
                        if attrs.get("ordered") and not task
                        else {}
                    ),
                }
            ]
        if kind in {"list_item", "task_list_item"}:
            if not content or content[0]["type"] != "paragraph":
                content.insert(0, {"type": "paragraph"})
            return [
                {
                    "type": "taskItem" if kind == "task_list_item" else "listItem",
                    "content": content,
                    **(
                        {"attrs": {"checked": attrs.get("checked", False)}}
                        if kind == "task_list_item"
                        else {}
                    ),
                }
            ]
        if kind == "table_body":
            return content
        if kind == "table_cell":
            return [
                {
                    "type": "tableHeader" if attrs.get("head") else "tableCell",
                    "content": [{"type": "paragraph", "content": content}],
                    "attrs": {"align": attrs.get("align") or "left"},
                }
            ]
        tag = {
            "block_quote": "blockquote",
            "table": "table",
            "table_head": "tableRow",
            "table_row": "tableRow",
        }.get(kind)
        if tag:
            return [{"type": tag, "content": content}]
        raise ThoughtError("不支持的 Markdown 结构：" + kind)

    try:
        document = {
            "type": "doc",
            "content": [node for token in parser(text) for node in convert(token)]
            or [{"type": "paragraph"}],
        }
        return validate_document(document), sorted(warnings)
    except (ValueError, RecursionError) as exc:
        raise ThoughtError("Markdown 结构超出文档限制") from exc


def markdown(document, paths):
    def walk(node):
        kind, attrs = node["type"], node.get("attrs", {})
        children = node.get("content", [])
        content = "".join(walk(child) for child in children)
        if kind == "text":
            text = re.sub(r"([\\`*_\[\]<>|])", r"\\\1", node.get("text", ""))
            for mark in node.get("marks", []):
                tag = mark["type"]
                pair = {"bold": "**", "italic": "*", "strike": "~~", "code": "`"}.get(tag)
                if pair:
                    text = (
                        pair + (node["text"].replace("`", "\\`") if tag == "code" else text) + pair
                    )
                if tag == "link":
                    text = f"[{text}](<{mark['attrs']['href']}>)"
            return text
        if kind in {"paragraph", "detailsSummary"}:
            return content + "\n\n"
        if kind == "heading":
            return "#" * attrs.get("level", 1) + " " + content + "\n\n"
        if kind == "hardBreak":
            return "  \n"
        if kind == "horizontalRule":
            return "\n---\n\n"
        if kind == "canvas":
            scene = remap_canvas(attrs["scene"], paths)
            source = json.dumps(scene, ensure_ascii=False).replace("`", "\\u0060")
            return "```fpl-canvas\n" + source + "\n```\n\n"
        if kind in {"codeBlock", "mermaid"}:
            source = (
                attrs.get("source", "")
                if kind == "mermaid"
                else "".join(c.get("text", "") for c in children)
            )
            fence = "`" * max(
                3, max((len(m.group()) + 1 for m in re.finditer(r"`+", source)), default=3)
            )
            language = "mermaid" if kind == "mermaid" else attrs.get("language", "")
            return f"{fence}{language}\n{source.rstrip()}\n{fence}\n\n"
        if kind in {"inlineMath", "blockMath"}:
            return (
                f"${attrs.get('latex', '')}$"
                if kind == "inlineMath"
                else f"\n$$\n{attrs.get('latex', '')}\n$$\n\n"
            )
        if kind in {"image", "attachment"}:
            title = attrs.get("alt", "") if kind == "image" else attrs.get("filename", "附件")
            title = title.replace("[", "\\[").replace("]", "\\]")
            return ("!" if kind == "image" else "") + f"[{title}]({paths[attrs['assetId']]})\n\n"
        if kind == "blockquote":
            return "\n".join("> " + line for line in content.strip().splitlines()) + "\n\n"
        if kind in {"bulletList", "orderedList", "taskList"}:
            result = []
            for index, child in enumerate(children):
                prefix = f"{index + attrs.get('start', 1)}. " if kind == "orderedList" else "- "
                if kind == "taskList":
                    prefix += "[x] " if child.get("attrs", {}).get("checked") else "[ ] "
                lines = walk(child).strip().splitlines() or [""]
                result.append(
                    prefix
                    + lines[0]
                    + "".join("\n" + " " * len(prefix) + line for line in lines[1:])
                )
            return "\n".join(result) + "\n\n"
        if kind == "table":
            rows = []
            for row in children:
                rows.append(
                    "| "
                    + " | ".join(walk(cell).strip().replace("\n", " ") for cell in row["content"])
                    + " |"
                )
            if rows:
                rows.insert(1, "| " + " | ".join("---" for _ in children[0]["content"]) + " |")
            return "\n".join(rows) + "\n\n"
        return content

    return walk(document).rstrip() + "\n"

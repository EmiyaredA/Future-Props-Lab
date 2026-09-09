"""Pure validation and projections of the supported editor document."""

from __future__ import annotations

import json
import re
from urllib.parse import urlsplit

NODES = {
    "doc",
    "paragraph",
    "text",
    "heading",
    "blockquote",
    "bulletList",
    "orderedList",
    "listItem",
    "taskList",
    "taskItem",
    "codeBlock",
    "hardBreak",
    "horizontalRule",
    "table",
    "tableRow",
    "tableCell",
    "tableHeader",
    "image",
    "attachment",
    "details",
    "detailsSummary",
    "detailsContent",
    "inlineMath",
    "blockMath",
    "mermaid",
}
MARKS = {"bold", "italic", "strike", "underline", "code", "textStyle", "highlight", "link"}
ATTRS = {
    "paragraph": {"textAlign"},
    "heading": {"level", "textAlign"},
    "orderedList": {"start", "type"},
    "taskItem": {"checked"},
    "codeBlock": {"language"},
    "tableCell": {"colspan", "rowspan", "colwidth", "align"},
    "tableHeader": {"colspan", "rowspan", "colwidth", "align"},
    "attachment": {"assetId", "filename", "mimeType", "byteSize"},
    "image": {"assetId", "alt", "title", "width", "height"},
    "details": {"open"},
    "inlineMath": {"latex"},
    "blockMath": {"latex"},
    "mermaid": {"source"},
    "textStyle": {"color", "fontSize", "backgroundColor", "fontFamily"},
    "highlight": {"color"},
    "link": {"href", "target", "rel", "class", "title"},
}
INLINE = {"text", "hardBreak", "inlineMath"}
BLOCKS = (
    NODES
    - INLINE
    - {
        "doc",
        "tableRow",
        "tableCell",
        "tableHeader",
        "listItem",
        "taskItem",
        "detailsSummary",
        "detailsContent",
    }
)
CHILDREN = {
    "doc": BLOCKS,
    "blockquote": BLOCKS,
    "tableCell": BLOCKS,
    "tableHeader": BLOCKS,
    "detailsContent": BLOCKS,
    "listItem": BLOCKS,
    "taskItem": BLOCKS,
    "paragraph": INLINE,
    "heading": INLINE,
    "detailsSummary": INLINE,
    "bulletList": {"listItem"},
    "orderedList": {"listItem"},
    "taskList": {"taskItem"},
    "table": {"tableRow"},
    "tableRow": {"tableCell", "tableHeader"},
    "details": {"detailsSummary", "detailsContent"},
    "codeBlock": {"text"},
}


def empty_document() -> dict:
    return {"type": "doc", "content": [{"type": "paragraph"}]}


def safe_link(value: str) -> bool:
    return not any(ord(c) < 32 for c in value) and urlsplit(value).scheme.lower() in {
        "http",
        "https",
        "mailto",
    }


def validate_document(document: dict) -> dict:
    if len(json.dumps(document, ensure_ascii=False).encode()) > 2 * 1024 * 1024:
        raise ValueError("笔记正文不能超过 2 MiB")
    count = 0

    def attrs(kind: str, values: dict) -> None:
        if not isinstance(values, dict) or set(values) - ATTRS.get(kind, set()):
            raise ValueError("不支持的富文本属性")
        for key, value in values.items():
            if value is None:
                continue
            if key in {"color", "backgroundColor"} and not re.fullmatch(
                r"#[0-9a-fA-F]{3,8}", str(value)
            ):
                raise ValueError("颜色格式无效")
            if key == "fontSize" and not re.fullmatch(r"(1[0-9]|[2-6][0-9]|72)px", str(value)):
                raise ValueError("字号无效")
            if key == "fontFamily" and value not in {"sans-serif", "serif", "monospace"}:
                raise ValueError("字体无效")
            if key == "textAlign" and value not in {"left", "center", "right", "justify"}:
                raise ValueError("对齐方式无效")
            if key in {"level", "colspan", "rowspan", "width", "height", "start"}:
                if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 10000:
                    raise ValueError("尺寸或编号无效")
                if key == "level" and value > 6:
                    raise ValueError("标题级别无效")
            if key == "colwidth" and (
                not isinstance(value, list)
                or len(value) > 100
                or any(not isinstance(v, int) or not 0 <= v <= 10000 for v in value)
            ):
                raise ValueError("列宽无效")
            if key in {"checked", "open"} and not isinstance(value, bool):
                raise ValueError("开关属性无效")
            if key == "href" and (not isinstance(value, str) or not safe_link(value)):
                raise ValueError("链接仅支持 http、https 和 mailto")
            if key in {
                "alt",
                "title",
                "assetId",
                "filename",
                "mimeType",
                "latex",
                "source",
                "language",
                "target",
                "rel",
                "class",
                "align",
                "type",
            }:
                if not isinstance(value, str) or len(value) > 50000:
                    raise ValueError("富文本属性无效")
            if key == "byteSize" and (type(value) is not int or value < 0):
                raise ValueError("文件大小无效")
        if kind in {"image", "attachment"} and not values.get("assetId"):
            raise ValueError("图片必须引用已上传的文件")

    def visit(node: dict, depth: int = 0) -> None:
        nonlocal count
        count += 1
        if depth > 32 or count > 20000 or not isinstance(node, dict):
            raise ValueError("正文结构过于复杂")
        kind = node.get("type")
        if (
            not isinstance(kind, str)
            or kind not in NODES
            or set(node) - {"type", "attrs", "content", "marks", "text"}
        ):
            raise ValueError("不支持的富文本节点")
        attrs(kind, node.get("attrs", {}))
        if kind == "text" and (not isinstance(node.get("text"), str) or not node["text"]):
            raise ValueError("文本节点无效")
        children = node.get("content", [])
        marks = node.get("marks", [])
        if not isinstance(children, list) or not isinstance(marks, list):
            raise ValueError("正文结构无效")
        if kind not in INLINE and marks:
            raise ValueError("文字格式只能应用于行内内容")
        if kind != "text" and "text" in node:
            raise ValueError("非文本节点不能包含文本属性")
        if (
            kind
            in {
                "doc",
                "blockquote",
                "table",
                "tableRow",
                "tableCell",
                "tableHeader",
                "bulletList",
                "orderedList",
                "taskList",
                "listItem",
                "taskItem",
                "detailsContent",
            }
            and not children
        ):
            raise ValueError("内容块不能为空")
        if kind == "details" and [c.get("type") for c in children if isinstance(c, dict)] != [
            "detailsSummary",
            "detailsContent",
        ]:
            raise ValueError("折叠段落必须包含摘要和正文")
        if kind in {"listItem", "taskItem"} and (
            not isinstance(children[0], dict) or children[0].get("type") != "paragraph"
        ):
            raise ValueError("列表项必须以段落开始")
        for mark in marks:
            if (
                not isinstance(mark, dict)
                or not isinstance(mark.get("type"), str)
                or mark.get("type") not in MARKS
                or set(mark) - {"type", "attrs"}
            ):
                raise ValueError("不支持的文字格式")
            attrs(mark["type"], mark.get("attrs", {}))
        for child in children:
            if not isinstance(child, dict):
                raise ValueError("正文结构无效")
            child_kind = child.get("type")
            if not isinstance(child_kind, str) or child_kind not in CHILDREN.get(kind, set()):
                raise ValueError("内容块嵌套结构无效")
            if kind == "codeBlock" and child.get("marks"):
                raise ValueError("代码块不能包含文字格式")
            visit(child, depth + 1)

    if document.get("type") != "doc":
        raise ValueError("正文必须为文档")
    visit(document)
    return document


def document_text(node: dict) -> str:
    if node.get("type") == "hardBreak":
        return "\n"
    if node.get("type") == "attachment":
        return node.get("attrs", {}).get("filename", "")
    value = node.get("text", "")
    if node.get("type") in {"inlineMath", "blockMath"}:
        value = node.get("attrs", {}).get("latex", "")
    if node.get("type") == "mermaid":
        value = node.get("attrs", {}).get("source", "")
    parts = [document_text(child) for child in node.get("content", [])]
    separator = (
        "\n"
        if node.get("type") not in {"paragraph", "heading", "detailsSummary", "codeBlock"}
        else ""
    )
    return value + separator.join(parts)


def image_ids(node: dict) -> set[str]:
    result = {node["attrs"]["assetId"]} if node.get("type") == "image" else set()
    for child in node.get("content", []):
        result.update(image_ids(child))
    return result


def attachment_nodes(node: dict):
    if node.get("type") == "attachment":
        yield node
    for child in node.get("content", []):
        yield from attachment_nodes(child)


def file_ids(node: dict) -> set[str]:
    return image_ids(node) | {n["attrs"]["assetId"] for n in attachment_nodes(node)}

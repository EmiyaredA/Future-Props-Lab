"""Project validated editor JSON into a provider-independent export snapshot."""

from copy import deepcopy

BLOCKED = {
    "canvas": "画板",
    "mermaid": "Mermaid 图",
    "multitableView": "多维表",
    "inlineMath": "公式",
    "blockMath": "公式",
    "attachment": "附件",
    "documentReference": "文档引用",
    "documentCard": "文档卡片",
    "cardGrid": "卡片导航",
    "documentDirectory": "文档目录",
}


def project_content(title: str, document: dict) -> dict:
    warnings, blockers, assets = [], [], set()

    def runs(node):
        result = []
        for child in node.get("content", []):
            if child["type"] == "text":
                style, link = {}, ""
                for mark in child.get("marks", []):
                    type = mark["type"]
                    mapped = {
                        "bold": "bold",
                        "italic": "italic",
                        "strike": "strikethrough",
                        "underline": "underline",
                        "code": "inline_code",
                    }.get(type)
                    if mapped:
                        style[mapped] = True
                    elif type == "link":
                        link = mark.get("attrs", {}).get("href", "")
                    else:
                        warnings.append("字号、颜色或高亮等样式会使用飞书默认样式")
                result.append({"text": child["text"], "style": style, "link": link})
            elif child["type"] == "hardBreak":
                result.append({"text": "\n"})
            else:
                result.extend(runs(child))
        return result

    def walk(node, path="正文", context="text"):
        type, attrs = node["type"], node.get("attrs", {})
        children = node.get("content", [])
        if type in BLOCKED:
            blockers.append(f"{path}：暂不支持{BLOCKED[type]}")
            return []
        if type == "image":
            assets.add(attrs["assetId"])
            if any(
                attrs.get(key) is not None
                for key in ("cropLeft", "cropTop", "cropWidth", "cropHeight")
            ):
                warnings.append("图片将同步完整原图；本地裁剪不保留")
            if attrs.get("width") or attrs.get("height") or attrs.get("align"):
                warnings.append("图片尺寸与对齐使用飞书默认样式")
            out = [{"kind": "image", "asset_id": attrs["assetId"]}]
            if attrs.get("caption"):
                out.append({"kind": "text", "runs": [{"text": attrs["caption"]}]})
            return out
        if type == "table":
            rows = []
            for i, row in enumerate(children):
                cells = []
                for j, cell in enumerate(row.get("content", [])):
                    a = cell.get("attrs", {})
                    if a.get("colspan", 1) != 1 or a.get("rowspan", 1) != 1:
                        blockers.append(f"{path}：暂不支持合并单元格")
                    if a.get("colwidth") or a.get("align"):
                        warnings.append("表格列宽、单元格对齐与表头使用飞书默认样式")
                    cells.append(walk(cell, f"{path}/第{i + 1}行第{j + 1}列"))
                rows.append(cells)
            if not rows or not rows[0] or any(len(r) != len(rows[0]) for r in rows):
                blockers.append(f"{path}：表格形状不完整")
            return [{"kind": "table", "rows": rows}]
        if type in {"paragraph", "heading", "codeBlock", "detailsSummary"}:
            if attrs.get("textAlign") and attrs["textAlign"] != "left":
                warnings.append("文字对齐使用飞书默认样式")
            value = {
                "kind": "heading"
                if type == "heading"
                else "code"
                if type == "codeBlock"
                else context,
                "runs": runs(node),
            }
            if type == "heading":
                value["level"] = attrs.get("level", 1)
            if type == "codeBlock" and attrs.get("language"):
                warnings.append("代码块以纯文本代码样式同步")
            return [value]
        if type == "horizontalRule":
            return [{"kind": "text", "runs": [{"text": "────────"}]}]
        next_context = {
            "blockquote": "quote",
            "callout": "quote",
            "bulletList": "bullet",
            "orderedList": "ordered",
            "taskList": "todo",
        }.get(type, context)
        out = []
        if type == "callout":
            warnings.append("提示框转为引用块")
            if attrs.get("title"):
                out.append({"kind": "quote", "runs": [{"text": attrs["title"]}]})
        if type == "details":
            warnings.append("折叠内容将全部展开")
        if type == "orderedList" and attrs.get("start", 1) != 1:
            warnings.append("有序列表编号从 1 开始")
        if type in {"orderedList", "bulletList", "taskList"} and context in {
            "ordered",
            "bullet",
            "todo",
        }:
            warnings.append("嵌套列表将按阅读顺序展开")
        for i, child in enumerate(children):
            out.extend(walk(child, f"{path}/第{i + 1}块", next_context))
        if type == "taskItem":
            for item in out:
                item["checked"] = attrs.get("checked", False)
        return out

    # Inspect inline unsupported nodes too, before flattening their containing paragraphs.
    def inspect(node, path):
        if node["type"] in BLOCKED:
            blockers.append(f"{path}：暂不支持{BLOCKED[node['type']]}")
        for i, child in enumerate(node.get("content", [])):
            inspect(child, f"{path}/第{i + 1}块")

    inspect(document, "正文")
    nodes = [{"kind": "heading", "level": 1, "runs": [{"text": title}]}] + walk(deepcopy(document))

    def text(nodes):
        result = []
        for n in nodes:
            if n["kind"] == "table":
                result.extend(" | ".join(text(cell) for cell in row) for row in n["rows"])
            elif n["kind"] == "image":
                result.append("[图片]")
            else:
                result.append("".join(r["text"] for r in n.get("runs", [])))
        return "\n".join(result)

    return {
        "nodes": nodes,
        "text": text(nodes),
        "asset_ids": sorted(assets),
        "warnings": sorted(set(warnings)),
        "blockers": sorted(set(blockers)),
    }

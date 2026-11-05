"""Translate neutral document blocks into Feishu descendants with explicit image slots."""

from uuid import uuid4

from studio.contracts.integrations.external_documents import ExternalError


def feishu_tree(nodes: list[dict]) -> dict:
    blocks: list[dict] = []
    images: dict[str, str] = {}

    def add(node: dict) -> str:
        id = str(uuid4())
        kind = node["kind"]
        block = {"block_id": id}
        if kind == "image":
            block.update(block_type=27, image={})
            images[id] = node["asset_id"]
        elif kind == "table":
            rows = node["rows"]
            cells = []
            for row in rows:
                for cell in row:
                    cell_id = str(uuid4())
                    children = [add(p) for p in cell] or [add({"kind": "text", "runs": []})]
                    blocks.append(
                        {
                            "block_id": cell_id,
                            "block_type": 32,
                            "table_cell": {},
                            "children": children,
                        }
                    )
                    cells.append(cell_id)
            block.update(
                block_type=31,
                table={"property": {"row_size": len(rows), "column_size": len(rows[0])}},
                children=cells,
            )
        else:
            mapping = {
                "text": (2, "text"),
                "bullet": (12, "bullet"),
                "ordered": (13, "ordered"),
                "code": (14, "code"),
                "quote": (15, "quote"),
                "todo": (17, "todo"),
            }
            if kind == "heading":
                level = min(9, max(1, node.get("level", 1)))
                type, key = level + 2, f"heading{level}"
            else:
                type, key = mapping[kind]
            elements = []
            for run in node.get("runs", []):
                style = {
                    k: v
                    for k, v in run.get("style", {}).items()
                    if k in {"bold", "italic", "strikethrough", "underline", "inline_code"}
                }
                if run.get("link"):
                    style["link"] = {"url": run["link"]}
                elements.append({"text_run": {"content": run["text"], "text_element_style": style}})
            content = {"elements": elements or [{"text_run": {"content": ""}}]}
            if kind == "code":
                content["style"] = {"language": 1}
            if kind == "todo":
                content["style"] = {"done": node.get("checked", False)}
            block.update(block_type=type, **{key: content})
        blocks.append(block)
        return id

    root_ids = [add(n) for n in nodes]
    if len(blocks) > 1000:
        raise ExternalError("文章超过单次内容块上限（1000），请拆分文章后同步")
    return {"root_ids": root_ids, "blocks": blocks, "images": images}

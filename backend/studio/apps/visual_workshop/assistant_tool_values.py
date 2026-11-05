"""Common Visual assistant tool contracts and pure canvas operation transforms."""

import json
from typing import Any
from uuid import uuid4

from studio.runtime.tasks.reactive_tools.types import AgentDefinition, RunBudgets, ToolBinding

TEXT_NODE_LIMIT = 4_000


def json_text(value: Any, limit: int = 12_000) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return text[:limit] + ("…[truncated]" if len(text) > limit else "")


def compact_node(node: dict[str, Any]) -> dict[str, Any]:
    position = node.get("position")
    if hasattr(position, "model_dump"):
        position = position.model_dump(mode="json")
    item = {
        "id": node.get("id"),
        "kind": node.get("kind"),
        "title": node.get("title"),
        "position": position,
    }
    if node.get("asset_id"):
        item["asset_id"] = node["asset_id"]
    if node.get("generation_task_id"):
        item["generation_task_id"] = node["generation_task_id"]
    if node.get("kind") == "text":
        text = str(node.get("text") or "")
        item["text"] = text[:TEXT_NODE_LIMIT]
        if len(text) > TEXT_NODE_LIMIT:
            item["text_truncated"] = True
    return item


def apply_operations(
    current_nodes: list[dict[str, Any]],
    current_edges: list[dict[str, Any]],
    operations: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    result = [dict(item) for item in current_nodes]
    edges = [dict(item) for item in current_edges]
    for operation in operations:
        op = operation.get("op")
        if op == "add_edge":
            edge = dict(operation.get("edge") or {})
            if not edge.get("id"):
                edge["id"] = f"edge-{uuid4()}"
            edges.append(edge)
            continue
        if op == "delete_edge":
            edge_id = str(operation.get("edge_id") or "")
            before = len(edges)
            edges = [edge for edge in edges if edge.get("id") != edge_id]
            if len(edges) == before:
                raise ValueError(f"连线不存在：{edge_id}")
            continue
        if op == "add":
            node = dict(operation.get("node") or {})
            if not node.get("id"):
                node["id"] = f"agent-{uuid4()}"
            if any(item.get("id") == node["id"] for item in result):
                raise ValueError(f"节点 ID 已存在：{node['id']}")
            result.append(node)
            continue
        node_id = str(operation.get("node_id") or "")
        index = next((i for i, item in enumerate(result) if item.get("id") == node_id), -1)
        if index < 0:
            raise ValueError(f"节点不存在：{node_id}")
        if op == "delete":
            result.pop(index)
            edges = [
                edge
                for edge in edges
                if edge.get("source_node_id") != node_id and edge.get("target_node_id") != node_id
            ]
        elif op == "update":
            changes = dict(operation.get("changes") or {})
            changes.pop("id", None)
            result[index] = {**result[index], **changes}
        else:
            raise ValueError(f"不支持的画布操作：{op}")
    return result, edges


def _tool(
    name: str,
    description: str,
    schema: dict[str, Any],
    effect: str,
    handler,
    generation_model_ids: dict[str, str | None] | None = None,
) -> ToolBinding:
    def summarize(arguments: dict[str, Any]) -> dict[str, Any]:
        if name == "apply_canvas_changes":
            operations = list(arguments.get("operations") or [])
            return {
                "label": "更新画布",
                "operation_count": len(operations),
                "operations": operations[:20],
            }
        if name == "start_generation_on_canvas":
            task = dict(arguments.get("task") or {})
            kind = str(task.get("kind") or "")
            configured_model_id = (generation_model_ids or {}).get(kind)
            return {
                "label": "创建生成任务",
                "kind": kind,
                "model_id": configured_model_id or task.get("model_id"),
                "prompt": str(task.get("prompt") or "")[:500],
                "node": arguments.get("node") or {},
            }
        return {"label": description, "arguments": arguments}

    return ToolBinding(name, description, schema, effect, handler, summarize)


def visual_agent_tools(
    handlers, *, image_model_id: str | None = None, video_model_id: str | None = None
) -> tuple[ToolBinding, ...]:
    object_schema = {"type": "object", "additionalProperties": True}
    generation_model_ids = {"image": image_model_id, "video": video_model_id}
    return (
        _tool(
            "read_canvas",
            "读取最新画布",
            {"type": "object", "properties": {}},
            "read",
            handlers["read_canvas"],
        ),
        _tool(
            "list_project_assets",
            "筛选当前项目可用素材",
            {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["image", "video", "audio", "document"]},
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                },
            },
            "read",
            handlers["list_project_assets"],
        ),
        _tool(
            "list_generation_options",
            "读取可用图片和视频生成模型",
            {"type": "object", "properties": {}},
            "read",
            handlers["list_generation_options"],
        ),
        _tool(
            "inspect_generation_task",
            "检查当前项目生成任务",
            {
                "type": "object",
                "properties": {"task_id": {"type": "string"}},
                "required": ["task_id"],
            },
            "read",
            handlers["inspect_generation_task"],
        ),
        _tool(
            "apply_canvas_changes",
            "批量新增、更新或删除画布节点和连线；把同一需求的多个变更合并到一次调用",
            {
                "type": "object",
                "properties": {
                    "operations": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 50,
                        "items": object_schema,
                    }
                },
                "required": ["operations"],
            },
            "write",
            handlers["apply_canvas_changes"],
        ),
        _tool(
            "start_generation_on_canvas",
            "为图片或视频节点创建生成记录；指定已有节点 ID 时沿用该节点，否则添加占位节点",
            {
                "type": "object",
                "properties": {"task": object_schema, "node": object_schema},
                "required": ["task", "node"],
            },
            "external",
            handlers["start_generation_on_canvas"],
            generation_model_ids,
        ),
    )


def build_visual_agent_definition(
    *,
    context_source,
    handlers,
    model: str,
    tools_enabled: bool,
    image_model_id: str | None = None,
    image_model_slug: str = "",
    video_model_id: str | None = None,
    video_model_slug: str = "",
) -> AgentDefinition:
    instructions = (
        "你是 Future Props Lab 视觉工坊的项目 Agent。你要理解项目、画布、素材和生成任务，"
        "给出清晰且可执行的创作帮助。需要最新事实时优先调用读取工具。"
        "只有在工具返回成功 Observation 后才能声称已执行操作。"
        "画布写入和图片/视频生成必须等待用户确认；等待、拒绝或冲突时不得声称已完成。"
        "多个相关画布节点或连线改动必须合并到一次 apply_canvas_changes 调用。"
        "不要删除项目、删除素材、上传文件或调用未提供的能力。"
    )
    if image_model_id:
        instructions += (
            f"当前对话固定使用图像生成模型 {image_model_slug or image_model_id}"
            f"（model_id={image_model_id}）；图片生成任务必须使用该模型。"
        )
    else:
        instructions += "当前对话的图像生成模型为自动选择，请从可用生成选项中选择。"
    if video_model_id:
        instructions += (
            f"当前对话固定使用视频生成模型 {video_model_slug or video_model_id}"
            f"（model_id={video_model_id}）；视频生成任务必须使用该模型。"
        )
    else:
        instructions += "当前对话的视频生成模型为自动选择，请从可用生成选项中选择。"
    if not tools_enabled:
        instructions += "当前模型不支持工具调用，本轮只能提供分析和建议，不得声称修改了项目。"
    return AgentDefinition(
        id="visual_workshop_agent",
        model=model,
        instructions=instructions,
        tools=(
            visual_agent_tools(
                handlers,
                image_model_id=image_model_id,
                video_model_id=video_model_id,
            )
            if tools_enabled
            else ()
        ),
        context_sources=(context_source,),
        budgets=RunBudgets(),
    )

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import or_, select

from app.agents.harness import (
    AgentDefinition,
    ContextFragment,
    Observation,
    RunBudgets,
    ToolBinding,
    ToolExecutionContext,
)
from app.core.db import SessionLocal
from app.models import (
    VisualAsset,
    VisualGenerationTask,
    VisualProjectAssetReference,
    VisualWorkshopProject,
)
from app.schemas.visual_workshop import (
    GenerationTaskCreateIn,
    VisualCanvasDocumentPutIn,
)
from app.visual_workshop.canvas import VisualCanvasDocuments
from app.visual_workshop.generation import VisualGeneration, generation_task_out

CANVAS_CONTEXT_LIMIT = 32_000
TEXT_NODE_LIMIT = 4_000
_generation_input = TypeAdapter(GenerationTaskCreateIn)


def _json_text(value: Any, limit: int = 12_000) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return text[:limit] + ("…[truncated]" if len(text) > limit else "")


def _compact_node(node: dict[str, Any]) -> dict[str, Any]:
    item = {
        "id": node.get("id"),
        "kind": node.get("kind"),
        "title": node.get("title"),
        "position": node.get("position"),
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


async def visual_context_source(project_id: str) -> list[ContextFragment]:
    async with SessionLocal() as session:
        project = await session.get(VisualWorkshopProject, project_id)
        canvas = await VisualCanvasDocuments(session).get(project_id)
        task_count = int(
            len(
                (
                    await session.execute(
                        select(VisualGenerationTask.id).where(
                            VisualGenerationTask.project_id == project_id
                        )
                    )
                )
                .scalars()
                .all()
            )
        )
    nodes = [_compact_node(dict(item)) for item in canvas.nodes]
    return [
        ContextFragment(
            "project",
            _json_text(
                {
                    "id": project_id,
                    "title": project.title if project else "",
                    "canvas_revision": canvas.revision,
                    "node_count": len(nodes),
                    "generation_task_count": task_count,
                }
            ),
            priority=100,
        ),
        ContextFragment(
            "canvas",
            _json_text(nodes, CANVAS_CONTEXT_LIMIT),
            priority=90,
            character_budget=CANVAS_CONTEXT_LIMIT,
        ),
    ]


async def _read_canvas(
    arguments: dict[str, Any], context: ToolExecutionContext
) -> Observation:
    del arguments
    project_id = str(context.scope["project_id"])
    async with SessionLocal() as session:
        canvas = await VisualCanvasDocuments(session).get(project_id)
    data = {
        "canvas_revision": canvas.revision,
        "nodes": [_compact_node(dict(item)) for item in canvas.nodes],
    }
    return Observation(
        context.tool_call_id,
        "read_canvas",
        True,
        f"当前画布 revision={canvas.revision}，共有 {len(canvas.nodes)} 个节点：{_json_text(data)}",
        data,
    )


async def _list_assets(
    arguments: dict[str, Any], context: ToolExecutionContext
) -> Observation:
    project_id = str(context.scope["project_id"])
    kind = str(arguments.get("kind") or "").strip()
    query = str(arguments.get("query") or "").strip()
    limit = min(50, max(1, int(arguments.get("limit") or 20)))
    async with SessionLocal() as session:
        reference_ids = select(VisualProjectAssetReference.asset_id).where(
            VisualProjectAssetReference.project_id == project_id
        )
        statement = select(VisualAsset).where(
            or_(VisualAsset.project_id == project_id, VisualAsset.id.in_(reference_ids))
        )
        if kind:
            statement = statement.where(VisualAsset.media_kind == kind)
        if query:
            statement = statement.where(VisualAsset.display_name.contains(query))
        rows = list(
            (
                await session.execute(
                    statement.order_by(VisualAsset.updated_at.desc()).limit(limit)
                )
            )
            .scalars()
            .all()
        )
    data = {
        "items": [
            {
                "id": item.id,
                "name": item.display_name,
                "kind": item.media_kind,
                "mime_type": item.mime_type,
                "byte_size": item.byte_size,
            }
            for item in rows
        ]
    }
    return Observation(
        context.tool_call_id,
        "list_project_assets",
        True,
        f"找到 {len(rows)} 个项目素材：{_json_text(data)}",
        data,
    )


async def _list_generation_options(
    arguments: dict[str, Any], context: ToolExecutionContext
) -> Observation:
    del arguments
    async with SessionLocal() as session:
        options = await VisualGeneration(session).options()
    data = options.model_dump(mode="json")
    return Observation(
        context.tool_call_id,
        "list_generation_options",
        True,
        f"当前可用生成模型：{_json_text(data)}",
        data,
    )


async def _inspect_generation_task(
    arguments: dict[str, Any], context: ToolExecutionContext
) -> Observation:
    project_id = str(context.scope["project_id"])
    task_id = str(arguments.get("task_id") or "")
    async with SessionLocal() as session:
        task = await session.get(VisualGenerationTask, task_id)
        if task is None or task.project_id != project_id:
            return Observation(
                context.tool_call_id,
                "inspect_generation_task",
                False,
                "生成任务不存在或不属于当前项目。",
                error_code="not_found",
            )
        data = generation_task_out(task).model_dump(mode="json")
    return Observation(
        context.tool_call_id,
        "inspect_generation_task",
        True,
        f"生成任务状态：{_json_text(data)}",
        data,
    )


def _apply_operations(
    current: list[dict[str, Any]], operations: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    result = [dict(item) for item in current]
    for operation in operations:
        op = operation.get("op")
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
        elif op == "update":
            changes = dict(operation.get("changes") or {})
            changes.pop("id", None)
            result[index] = {**result[index], **changes}
        else:
            raise ValueError(f"不支持的画布操作：{op}")
    return result


async def _apply_canvas_changes(
    arguments: dict[str, Any], context: ToolExecutionContext
) -> Observation:
    project_id = str(context.scope["project_id"])
    operations = list(arguments.get("operations") or [])
    async with SessionLocal() as session:
        documents = VisualCanvasDocuments(session)
        current = await documents.get(project_id)
        if context.approved_canvas_revision != current.revision:
            return Observation(
                context.tool_call_id,
                "apply_canvas_changes",
                False,
                (
                    "用户确认后画布已经变化，旧提案未执行。"
                    f"提案 revision={context.approved_canvas_revision}，"
                    f"当前 revision={current.revision}。请重新读取画布并规划。"
                ),
                {"canvas_revision": current.revision},
                error_code="canvas_conflict",
                retryable=True,
            )
        try:
            nodes = _apply_operations([dict(item) for item in current.nodes], operations)
            body = VisualCanvasDocumentPutIn(
                expected_revision=current.revision,
                nodes=nodes,
            )
        except (ValueError, ValidationError) as exc:
            return Observation(
                context.tool_call_id,
                "apply_canvas_changes",
                False,
                f"画布变更无效：{str(exc)[:1000]}",
                error_code="invalid_canvas_change",
            )
        updated = await documents.put(project_id, body)
    data = updated.model_dump(mode="json")
    return Observation(
        context.tool_call_id,
        "apply_canvas_changes",
        True,
        f"已更新画布，revision={updated.revision}。",
        data,
    )


async def _start_generation_on_canvas(
    arguments: dict[str, Any], context: ToolExecutionContext
) -> Observation:
    project_id = str(context.scope["project_id"])
    task_payload = dict(arguments.get("task") or {})
    node_payload = dict(arguments.get("node") or {})
    async with SessionLocal() as session:
        documents = VisualCanvasDocuments(session)
        current = await documents.get(project_id)
        if context.approved_canvas_revision != current.revision:
            return Observation(
                context.tool_call_id,
                "start_generation_on_canvas",
                False,
                "画布在确认后发生变化，生成任务和占位节点均未创建。请重新规划。",
                {"canvas_revision": current.revision},
                error_code="canvas_conflict",
                retryable=True,
            )
        try:
            body = _generation_input.validate_python(task_payload)
            task = await VisualGeneration(session).prepare_create(project_id, body)
            node = {
                "id": str(node_payload.get("id") or f"agent-{uuid4()}"),
                "kind": body.kind,
                "title": str(node_payload.get("title") or "AI 生成内容")[:120],
                "position": node_payload.get("position") or {"x": 0, "y": 0},
                "asset_id": None,
                "generation_task_id": task.id,
            }
            canvas_body = VisualCanvasDocumentPutIn(
                expected_revision=current.revision,
                nodes=[*current.nodes, node],
            )
            updated = await documents.replace(project_id, canvas_body)
            await session.commit()
            await session.refresh(task)
        except Exception:
            await session.rollback()
            raise
    task_out = generation_task_out(task)
    data = {
        "task": task_out.model_dump(mode="json"),
        "node": node,
        "canvas_revision": updated.revision,
        "nodes": updated.nodes,
    }
    return Observation(
        context.tool_call_id,
        "start_generation_on_canvas",
        True,
        f"已创建 {body.kind} 生成任务 {task.id} 和画布占位节点 {node['id']}。",
        data,
    )


def _tool(
    name: str,
    description: str,
    schema: dict[str, Any],
    effect: str,
    handler,
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
            return {
                "label": "创建生成任务",
                "kind": task.get("kind"),
                "model_id": task.get("model_id"),
                "prompt": str(task.get("prompt") or "")[:500],
                "node": arguments.get("node") or {},
            }
        return {"label": description, "arguments": arguments}

    return ToolBinding(name, description, schema, effect, handler, summarize)


def visual_agent_tools() -> tuple[ToolBinding, ...]:
    object_schema = {"type": "object", "additionalProperties": True}
    return (
        _tool(
            "read_canvas",
            "读取最新画布",
            {"type": "object", "properties": {}},
            "read",
            _read_canvas,
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
            _list_assets,
        ),
        _tool(
            "list_generation_options",
            "读取可用图片和视频生成模型",
            {"type": "object", "properties": {}},
            "read",
            _list_generation_options,
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
            _inspect_generation_task,
        ),
        _tool(
            "apply_canvas_changes",
            "批量新增、更新或删除画布节点；把同一需求的多个变更合并到一次调用",
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
            _apply_canvas_changes,
        ),
        _tool(
            "start_generation_on_canvas",
            "创建图片或视频生成任务，并同时添加画布占位节点",
            {
                "type": "object",
                "properties": {"task": object_schema, "node": object_schema},
                "required": ["task", "node"],
            },
            "external",
            _start_generation_on_canvas,
        ),
    )


def build_visual_agent_definition(
    *, project_id: str, model: str, tools_enabled: bool
) -> AgentDefinition:
    instructions = (
        "你是 Future Props Lab 视觉工坊的项目 Agent。你要理解项目、画布、素材和生成任务，"
        "给出清晰且可执行的创作帮助。需要最新事实时优先调用读取工具。"
        "只有在工具返回成功 Observation 后才能声称已执行操作。"
        "画布写入和图片/视频生成必须等待用户确认；等待、拒绝或冲突时不得声称已完成。"
        "多个相关画布改动必须合并到一次 apply_canvas_changes 调用。"
        "不要删除项目、删除素材、上传文件或调用未提供的能力。"
    )
    if not tools_enabled:
        instructions += "当前模型不支持工具调用，本轮只能提供分析和建议，不得声称修改了项目。"
    return AgentDefinition(
        id="visual_workshop_agent",
        model=model,
        instructions=instructions,
        tools=visual_agent_tools() if tools_enabled else (),
        context_sources=(lambda: visual_context_source(project_id),),
        budgets=RunBudgets(),
    )

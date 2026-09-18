from __future__ import annotations

import json
from functools import partial
from typing import Any
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import or_, select

from app.apps.visual_workshop.canvas import VisualCanvasDocuments
from app.apps.visual_workshop.generation import (
    GenerationError,
    VisualGeneration,
    generation_task_out,
)
from app.apps.visual_workshop.models import (
    VisualGenerationTask,
    VisualWorkshopProject,
)
from app.apps.visual_workshop.schemas.workshop import (
    GenerationTaskCreateIn,
    VisualCanvasDocumentPutIn,
)
from app.capabilities.agents.harness import (
    AgentDefinition,
    ContextFragment,
    Observation,
    RunBudgets,
    ToolBinding,
    ToolExecutionContext,
)
from app.models import (
    VisualAsset,
    VisualProjectAssetReference,
)
from app.orm import bind_workspace
from app.runtime.db import SessionLocal

CANVAS_CONTEXT_LIMIT = 32_000
TEXT_NODE_LIMIT = 4_000
_generation_input = TypeAdapter(GenerationTaskCreateIn)


def _scope_workspace(context: ToolExecutionContext) -> str:
    workspace_id = str(context.scope.get("workspace_id") or "").strip()
    if not workspace_id:
        raise ValueError("工具执行上下文缺少 Workspace 归属")
    return workspace_id


def _json_text(value: Any, limit: int = 12_000) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return text[:limit] + ("…[truncated]" if len(text) > limit else "")


def _compact_node(node: dict[str, Any]) -> dict[str, Any]:
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


async def visual_context_source(workspace_id: str, project_id: str) -> list[ContextFragment]:
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, workspace_id)
        project = await session.get(VisualWorkshopProject, project_id)
        canvas = await VisualCanvasDocuments(session).get(project_id)
        reference_ids = select(VisualProjectAssetReference.asset_id).where(
            VisualProjectAssetReference.project_id == project_id
        )
        assets = list(
            (
                await session.execute(
                    select(VisualAsset)
                    .where(
                        or_(
                            VisualAsset.project_id == project_id,
                            VisualAsset.id.in_(reference_ids),
                        )
                    )
                    .order_by(VisualAsset.updated_at.desc())
                    .limit(60)
                )
            )
            .scalars()
            .all()
        )
        tasks = list(
            (
                await session.execute(
                    select(VisualGenerationTask)
                    .where(VisualGenerationTask.project_id == project_id)
                    .order_by(VisualGenerationTask.updated_at.desc())
                    .limit(40)
                )
            )
            .scalars()
            .all()
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
                    "asset_count": len(assets),
                    "generation_task_count": len(tasks),
                }
            ),
            priority=100,
        ),
        ContextFragment(
            "canvas",
            _json_text(
                {"nodes": nodes, "edges": [edge.model_dump(mode="json") for edge in canvas.edges]},
                CANVAS_CONTEXT_LIMIT,
            ),
            priority=90,
            character_budget=CANVAS_CONTEXT_LIMIT,
        ),
        ContextFragment(
            "assets",
            _json_text(
                [
                    {
                        "id": item.id,
                        "name": item.display_name,
                        "kind": item.media_kind,
                        "mime_type": item.mime_type,
                        "byte_size": item.byte_size,
                    }
                    for item in assets
                ],
                8_000,
            ),
            priority=70,
            character_budget=8_000,
        ),
        ContextFragment(
            "generation_tasks",
            _json_text(
                [
                    {
                        "id": item.id,
                        "kind": item.kind,
                        "status": item.status,
                        "model": item.model_slug,
                        "result_asset_id": item.result_asset_id,
                    }
                    for item in tasks
                ],
                8_000,
            ),
            priority=60,
            character_budget=8_000,
        ),
    ]


async def _read_canvas(arguments: dict[str, Any], context: ToolExecutionContext) -> Observation:
    del arguments
    project_id = str(context.scope["project_id"])
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, _scope_workspace(context))
        canvas = await VisualCanvasDocuments(session).get(project_id)
    data = {
        "canvas_revision": canvas.revision,
        "nodes": [_compact_node(dict(item)) for item in canvas.nodes],
        "edges": [edge.model_dump(mode="json") for edge in canvas.edges],
    }
    return Observation(
        context.tool_call_id,
        "read_canvas",
        True,
        f"当前画布 revision={canvas.revision}，共有 {len(canvas.nodes)} 个节点：{_json_text(data)}",
        data,
    )


async def _list_assets(arguments: dict[str, Any], context: ToolExecutionContext) -> Observation:
    project_id = str(context.scope["project_id"])
    kind = str(arguments.get("kind") or "").strip()
    query = str(arguments.get("query") or "").strip()
    limit = min(50, max(1, int(arguments.get("limit") or 20)))
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, _scope_workspace(context))
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
            (await session.execute(statement.order_by(VisualAsset.updated_at.desc()).limit(limit)))
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
        bind_workspace(session.sync_session, _scope_workspace(context))
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
        bind_workspace(session.sync_session, _scope_workspace(context))
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


async def _apply_canvas_changes(
    arguments: dict[str, Any], context: ToolExecutionContext
) -> Observation:
    project_id = str(context.scope["project_id"])
    operations = list(arguments.get("operations") or [])
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, _scope_workspace(context))
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
            nodes, edges = _apply_operations(
                [node.model_dump(mode="json") for node in current.nodes],
                [edge.model_dump(mode="json") for edge in current.edges],
                operations,
            )
            body = VisualCanvasDocumentPutIn(
                expected_revision=current.revision,
                nodes=nodes,
                edges=edges,
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
    data["canvas_revision"] = updated.revision
    return Observation(
        context.tool_call_id,
        "apply_canvas_changes",
        True,
        f"已更新画布，revision={updated.revision}。",
        data,
    )


async def _start_generation_on_canvas(
    arguments: dict[str, Any], context: ToolExecutionContext, *, admission=None
) -> Observation:
    project_id = str(context.scope["project_id"])
    task_payload = dict(arguments.get("task") or {})
    node_payload = dict(arguments.get("node") or {})
    generation_kind = str(task_payload.get("kind") or "")
    configured_model_id = context.scope.get(f"{generation_kind}_model_id")
    if generation_kind in {"image", "video"} and configured_model_id:
        task_payload["model_id"] = str(configured_model_id)
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, _scope_workspace(context))
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
                edges=current.edges,
            )
            updated = await documents.replace(project_id, canvas_body)
            if admission:
                await admission(session, [task.id])
            await session.commit()
            await session.refresh(task)
        except GenerationError as exc:
            await session.rollback()
            if configured_model_id and exc.code in {"model_unavailable", "missing_api_key"}:
                label = "图像" if generation_kind == "image" else "视频"
                return Observation(
                    context.tool_call_id,
                    "start_generation_on_canvas",
                    False,
                    f"当前对话固定的{label}生成模型不可用，请重新配置后再试。",
                    {
                        "kind": generation_kind,
                        "model_id": str(configured_model_id),
                        "canvas_revision": current.revision,
                    },
                    error_code="configured_model_unavailable",
                )
            raise
        except Exception:
            await session.rollback()
            raise
    task_out = generation_task_out(task)
    data = {
        "task": task_out.model_dump(mode="json"),
        "node": node,
        "canvas_revision": updated.revision,
        "nodes": updated.nodes,
        "edges": updated.edges,
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
    *, image_model_id: str | None = None, video_model_id: str | None = None, admission=None
) -> tuple[ToolBinding, ...]:
    object_schema = {"type": "object", "additionalProperties": True}
    generation_model_ids = {"image": image_model_id, "video": video_model_id}
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
            partial(_start_generation_on_canvas, admission=admission),
            generation_model_ids,
        ),
    )


def build_visual_agent_definition(
    *,
    workspace_id: str,
    project_id: str,
    model: str,
    tools_enabled: bool,
    image_model_id: str | None = None,
    image_model_slug: str = "",
    video_model_id: str | None = None,
    video_model_slug: str = "",
    admission=None,
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
                image_model_id=image_model_id,
                video_model_id=video_model_id,
                admission=admission,
            )
            if tools_enabled
            else ()
        ),
        context_sources=(lambda: visual_context_source(workspace_id, project_id),),
        budgets=RunBudgets(),
    )

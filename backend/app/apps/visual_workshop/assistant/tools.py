from __future__ import annotations

from functools import partial
from typing import Any
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import or_, select

from app.apps.visual_workshop.assistant_tool_values import (
    apply_operations as _apply_operations,
)
from app.apps.visual_workshop.assistant_tool_values import (
    build_visual_agent_definition as build_definition,
)
from app.apps.visual_workshop.assistant_tool_values import (
    compact_node as _compact_node,
)
from app.apps.visual_workshop.assistant_tool_values import (
    json_text as _json_text,
)
from app.apps.visual_workshop.assistant_tool_values import (
    visual_agent_tools as bind_tools,
)
from app.apps.visual_workshop.canvas import VisualCanvasDocuments
from app.apps.visual_workshop.generation import (
    GenerationError,
    VisualGeneration,
)
from app.apps.visual_workshop.generation_common import generation_task_out
from app.apps.visual_workshop.models import (
    VisualGenerationTask,
    VisualWorkshopProject,
)
from app.apps.visual_workshop.node_placement import automatic_node_position
from app.apps.visual_workshop.schemas.workshop import (
    GenerationTaskCreateIn,
    VisualCanvasDocumentPutIn,
)
from app.capabilities.agents.harness import (
    AgentDefinition,
    ContextFragment,
    Observation,
    ToolBinding,
    ToolExecutionContext,
)
from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualProjectAssetReference,
)
from app.runtime.db import SessionLocal
from app.runtime.ownership import bind_owner

CANVAS_CONTEXT_LIMIT = 32_000
_generation_input = TypeAdapter(GenerationTaskCreateIn)


def _scope_owner(context: ToolExecutionContext) -> str:
    owner_user_id = str(context.scope.get("owner_user_id") or "").strip()
    if not owner_user_id:
        raise ValueError("工具执行上下文缺少账号归属")
    return owner_user_id


async def visual_context_source(owner_user_id: str, project_id: str) -> list[ContextFragment]:
    async with SessionLocal() as session:
        bind_owner(session.sync_session, owner_user_id)
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
        bind_owner(session.sync_session, _scope_owner(context))
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
        bind_owner(session.sync_session, _scope_owner(context))
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
        bind_owner(session.sync_session, _scope_owner(context))
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
        bind_owner(session.sync_session, _scope_owner(context))
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


async def _apply_canvas_changes(
    arguments: dict[str, Any], context: ToolExecutionContext
) -> Observation:
    project_id = str(context.scope["project_id"])
    operations = list(arguments.get("operations") or [])
    async with SessionLocal() as session:
        bind_owner(session.sync_session, _scope_owner(context))
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
        bind_owner(session.sync_session, _scope_owner(context))
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
            existing_id = task_payload.get("canvas_node_id") or node_payload.get("id")
            existing = next((node for node in current.nodes if node.id == existing_id), None)
            if existing:
                task_payload.update(
                    canvas_node_id=existing.id, expected_canvas_revision=current.revision
                )
            body = _generation_input.validate_python(task_payload)
            task = await VisualGeneration(session).prepare_create(project_id, body)
            if existing:
                node = {**existing.model_dump(mode="json"), "generation_task_id": task.id}
            else:
                node = {
                    "id": str(node_payload.get("id") or f"agent-{uuid4()}"),
                    "kind": body.kind,
                    "title": str(node_payload.get("title") or "AI 生成内容")[:120],
                    "position": node_payload.get("position")
                    or automatic_node_position(
                        [item.model_dump(mode="json") for item in current.nodes], body.kind
                    ),
                    "asset_id": None,
                    "generation_task_id": task.id,
                }
            canvas_body = VisualCanvasDocumentPutIn(
                expected_revision=current.revision,
                nodes=[node if item.id == existing.id else item for item in current.nodes]
                if existing
                else [*current.nodes, node],
                edges=current.edges,
            )
            updated = await documents.replace(project_id, canvas_body)
            task.canvas_node_id = node["id"]
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
        f"已为画布节点 {node['id']} 创建 {body.kind} 生成记录 {task.id}。",
        data,
    )


def tool_handlers(admission):
    return {
        "read_canvas": _read_canvas,
        "list_project_assets": _list_assets,
        "list_generation_options": _list_generation_options,
        "inspect_generation_task": _inspect_generation_task,
        "apply_canvas_changes": _apply_canvas_changes,
        "start_generation_on_canvas": partial(_start_generation_on_canvas, admission=admission),
    }


def visual_agent_tools(
    *, image_model_id: str | None = None, video_model_id: str | None = None, admission=None
) -> tuple[ToolBinding, ...]:
    return bind_tools(
        tool_handlers(admission), image_model_id=image_model_id, video_model_id=video_model_id
    )


def build_visual_agent_definition(
    *,
    owner_user_id: str,
    project_id: str,
    model: str,
    tools_enabled: bool,
    image_model_id: str | None = None,
    image_model_slug: str = "",
    video_model_id: str | None = None,
    video_model_slug: str = "",
    admission=None,
) -> AgentDefinition:
    return build_definition(
        context_source=lambda: visual_context_source(owner_user_id, project_id),
        handlers=tool_handlers(admission),
        model=model,
        tools_enabled=tools_enabled,
        image_model_id=image_model_id,
        image_model_slug=image_model_slug,
        video_model_id=video_model_id,
        video_model_slug=video_model_slug,
    )

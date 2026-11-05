"""Run the approved generation tool through Visual's independently owned task intake."""

from uuid import uuid4

from pydantic import TypeAdapter, ValidationError

from studio.apps.visual_workshop.assistant.assistant_canvas_actions import changed, require_approval
from studio.apps.visual_workshop.generation.generation_intake import GenerationIntake
from studio.apps.visual_workshop.generation_common import GenerationError
from studio.apps.visual_workshop.node_placement import automatic_node_position
from studio.apps.visual_workshop.projects import Projects
from studio.apps.visual_workshop.schemas.workshop import GenerationTaskCreateIn, VisualCanvasNode
from studio.runtime.project_errors import ProjectResourceError
from studio.runtime.tasks.reactive_tools.types import Observation

TASK = TypeAdapter(GenerationTaskCreateIn)
NODE = TypeAdapter(VisualCanvasNode)
TOOL = "start_generation_on_canvas"


class AssistantGenerationAction:
    def __init__(self, state, turn):
        self.state, self.turn = state, turn

    async def start_generation_on_canvas(self, arguments, context):
        owner, scope = self.turn.owner, self.turn.scope
        project = scope.project_id
        task_payload = dict(arguments.get("task") or {})
        node_payload = dict(arguments.get("node") or {})
        kind = task_payload.get("kind")
        configured = {"image": self.turn.image_model_id, "video": self.turn.video_model_id}.get(
            kind
        )
        if configured:
            task_payload["model_id"] = configured
        try:
            path = require_approval(context, scope)
            async with self.state.database.sessions(info={"owner_user_id": owner}) as session:
                canvas = await Projects(session, owner).canvas(project)
                if canvas.revision != context.approved_canvas_revision:
                    return changed(context, TOOL, canvas.revision)
                body, draft = prepare_node(canvas, task_payload, node_payload)
                task, updated = await GenerationIntake(
                    self.state,
                    session,
                    owner,
                    assertion=context.approval_authorization,
                    source=path,
                ).create(project, body, draft_node=draft)
        except GenerationError as exc:
            if exc.code == "canvas_revision_conflict":
                async with self.state.database.sessions(info={"owner_user_id": owner}) as session:
                    latest = await Projects(session, owner).canvas(project)
                return changed(context, TOOL, latest.revision)
            if configured and exc.code in {"model_unavailable", "missing_api_key"}:
                label = "图像" if kind == "image" else "视频"
                return Observation(
                    context.tool_call_id,
                    TOOL,
                    False,
                    f"当前对话固定的{label}生成模型不可用，请重新配置后再试。",
                    {
                        "kind": kind,
                        "model_id": configured,
                        "canvas_revision": context.approved_canvas_revision,
                    },
                    error_code="configured_model_unavailable",
                )
            return Observation(context.tool_call_id, TOOL, False, str(exc), error_code=exc.code)
        except ProjectResourceError as exc:
            return Observation(context.tool_call_id, TOOL, False, str(exc), error_code=exc.code)
        except ValidationError as exc:
            return Observation(
                context.tool_call_id,
                TOOL,
                False,
                f"生成请求或占位节点无效：{str(exc)[:1000]}",
                error_code="invalid_generation",
            )
        data = updated.model_dump(mode="json")
        node = next((item for item in data["nodes"] if item["id"] == body.canvas_node_id), None)
        return Observation(
            context.tool_call_id,
            TOOL,
            True,
            f"已为画布节点 {body.canvas_node_id} 创建 {body.kind} 生成记录 {task.id}。",
            {
                "task": task.model_dump(mode="json"),
                "node": node,
                "canvas_revision": updated.revision,
                "nodes": data["nodes"],
                "edges": data["edges"],
            },
        )


def prepare_node(canvas, task_payload, node_payload):
    requested = task_payload.get("canvas_node_id")
    existing = next(
        (node for node in canvas.nodes if node.id == (requested or node_payload.get("id"))),
        None,
    )
    if requested and existing is None:
        raise GenerationError("画布节点不存在", code="canvas_node_not_found", status=404)
    draft = None
    if existing is None:
        kind = task_payload.get("kind")
        draft = NODE.validate_python(
            {
                "id": node_payload.get("id") or f"agent-{uuid4()}",
                "kind": kind,
                "title": str(node_payload.get("title") or "AI 生成内容")[:120],
                "position": node_payload.get("position")
                or automatic_node_position(
                    [item.model_dump(mode="json") for item in canvas.nodes], kind
                ),
            }
        )
    return TASK.validate_python(
        {
            **task_payload,
            "canvas_node_id": existing.id if existing else draft.id,
            "expected_canvas_revision": canvas.revision,
        }
    ), draft

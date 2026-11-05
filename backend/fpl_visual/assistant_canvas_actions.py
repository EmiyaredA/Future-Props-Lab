"""Apply an authorized assistant proposal to the exact approved Canvas revision."""

from app.apps.visual_workshop.assistant_tool_values import apply_operations
from app.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentPutIn
from app.capabilities.agents.harness import Observation
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.visual_assistant import approval_path

from .canvas_writes import CanvasWrites
from .projects import Projects


def require_approval(context, scope):
    if (
        context.run_id != scope.run_id
        or context.approved_canvas_revision is None
        or context.approval_id is None
        or context.approval_authorization is None
    ):
        raise ProjectResourceError("工具操作缺少有效审批", "approval_not_found", 404)
    return approval_path(scope.project_id, scope.conversation_id, scope.run_id, context.approval_id)


class AssistantCanvasActions:
    def __init__(self, state, turn):
        self.state = state
        self.owner = turn.owner
        self.scope = turn.scope

    async def apply_canvas_changes(self, arguments, context):
        project = self.scope.project_id
        tool = "apply_canvas_changes"
        try:
            path = require_approval(context, self.scope)
            async with self.state.database.sessions(info={"owner_user_id": self.owner}) as session:
                canvas = await Projects(session, self.owner).canvas(project)
                if canvas.revision != context.approved_canvas_revision:
                    return changed(context, tool, canvas.revision)
                nodes, edges = apply_operations(
                    [node.model_dump(mode="json") for node in canvas.nodes],
                    [edge.model_dump(mode="json") for edge in canvas.edges],
                    arguments.get("operations") or [],
                )
                body = VisualCanvasDocumentPutIn(
                    expected_revision=canvas.revision, nodes=nodes, edges=edges
                )
                updated = await CanvasWrites(
                    session,
                    self.owner,
                    self.state.reference_mutations,
                    context.approval_authorization,
                ).apply_approved(project, body, path)
        except RevisionConflictError as exc:
            return changed(context, tool, exc.current)
        except ValueError as exc:
            return Observation(
                context.tool_call_id,
                tool,
                False,
                f"画布变更无效：{str(exc)[:1000]}",
                error_code="invalid_canvas_change",
            )
        except ProjectResourceError as exc:
            return Observation(context.tool_call_id, tool, False, str(exc), error_code=exc.code)
        data = updated.model_dump(mode="json")
        data["canvas_revision"] = updated.revision
        return Observation(
            context.tool_call_id, tool, True, f"已更新画布，revision={updated.revision}。", data
        )


def changed(context, tool, current):
    return Observation(
        context.tool_call_id,
        tool,
        False,
        "用户确认后画布已经变化，旧提案未执行。"
        f"提案 revision={context.approved_canvas_revision}，当前 revision={current}。"
        "请重新读取画布并规划。",
        {"canvas_revision": current},
        error_code="canvas_conflict",
        retryable=True,
    )

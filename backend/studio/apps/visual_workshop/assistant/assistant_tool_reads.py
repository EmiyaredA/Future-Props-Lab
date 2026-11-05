"""Visual assistant observations assembled from owned project state and scoped peers."""

from sqlalchemy import select

from studio.apps.visual_workshop.assistant_tool_values import compact_node, json_text
from studio.apps.visual_workshop.generation_common import generation_task_out
from studio.apps.visual_workshop.projects import Projects
from studio.apps.visual_workshop.storage.models import VisualGenerationTask
from studio.contracts.visual_workshop.visual_assistant import CanvasAssetSearch
from studio.runtime.tasks.reactive_tools.types import ContextFragment, Observation

CANVAS_CONTEXT_LIMIT = 32_000


def canvas_values(canvas):
    return {
        "nodes": [compact_node(node.model_dump(mode="json")) for node in canvas.nodes],
        "edges": [edge.model_dump(mode="json") for edge in canvas.edges],
    }


def asset_values(rows):
    return [
        {
            "id": row.id,
            "name": row.display_name,
            "kind": row.media_kind,
            "mime_type": row.mime_type,
            "byte_size": row.byte_size,
        }
        for row in rows
    ]


class AssistantToolReads:
    def __init__(self, sessions, peers, turn):
        self.sessions = sessions
        self.peers = peers
        self.owner = turn.owner
        self.project = turn.scope.project_id
        self.conversation = turn.scope.conversation_id

    def session(self):
        return self.sessions(info={"owner_user_id": self.owner})

    async def context(self):
        async with self.session() as session:
            projects = Projects(session, self.owner)
            project = await projects.get(self.project)
            canvas = await projects.canvas(self.project)
            tasks = await session.scalars(
                self.task_query().order_by(VisualGenerationTask.updated_at.desc()).limit(40)
            )
            task_summary = [
                {
                    "id": item.id,
                    "kind": item.kind,
                    "status": item.status,
                    "model": item.model_slug,
                    "result_asset_id": item.result_asset_id,
                }
                for item in tasks
            ]
        assets = await self.peers.search_assets(
            self.project, self.conversation, CanvasAssetSearch(limit=60)
        )
        return [
            ContextFragment(
                "project",
                json_text(
                    {
                        "id": self.project,
                        "title": project.title,
                        "canvas_revision": canvas.revision,
                        "node_count": len(canvas.nodes),
                        "asset_count": len(assets),
                        "generation_task_count": len(task_summary),
                    }
                ),
                priority=100,
            ),
            ContextFragment(
                "canvas",
                json_text(canvas_values(canvas), CANVAS_CONTEXT_LIMIT),
                priority=90,
                character_budget=CANVAS_CONTEXT_LIMIT,
            ),
            ContextFragment(
                "assets",
                json_text(asset_values(assets), 8_000),
                priority=70,
                character_budget=8_000,
            ),
            ContextFragment(
                "generation_tasks",
                json_text(task_summary, 8_000),
                priority=60,
                character_budget=8_000,
            ),
        ]

    def task_query(self):
        return select(VisualGenerationTask).where(
            VisualGenerationTask.owner_user_id == self.owner,
            VisualGenerationTask.project_id == self.project,
        )

    async def read_canvas(self, _arguments, context):
        async with self.session() as session:
            canvas = await Projects(session, self.owner).canvas(self.project)
        data = {"canvas_revision": canvas.revision, **canvas_values(canvas)}
        return Observation(
            context.tool_call_id,
            "read_canvas",
            True,
            f"当前画布 revision={canvas.revision}，共有 {len(canvas.nodes)} 个节点："
            f"{json_text(data)}",
            data,
        )

    async def list_project_assets(self, arguments, context):
        search = CanvasAssetSearch(
            kind=arguments.get("kind") or None,
            query=str(arguments.get("query") or "").strip(),
            limit=min(50, max(1, int(arguments.get("limit") or 20))),
        )
        rows = await self.peers.search_assets(self.project, self.conversation, search)
        data = {"items": asset_values(rows)}
        return Observation(
            context.tool_call_id,
            "list_project_assets",
            True,
            f"找到 {len(rows)} 个项目素材：{json_text(data)}",
            data,
        )

    async def list_generation_options(self, _arguments, context):
        options = await self.peers.generation_options()
        data = options.model_dump(mode="json")
        return Observation(
            context.tool_call_id,
            "list_generation_options",
            True,
            f"当前可用生成模型：{json_text(data)}",
            data,
        )

    async def inspect_generation_task(self, arguments, context):
        task_id = str(arguments.get("task_id") or "")
        async with self.session() as session:
            task = await session.scalar(self.task_query().where(VisualGenerationTask.id == task_id))
            if task is None:
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
            f"生成任务状态：{json_text(data)}",
            data,
        )

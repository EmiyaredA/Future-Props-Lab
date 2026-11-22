"""Canvas mutations that use Visual-owned rows and a caller-provided asset check."""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.visual_workshop.acceptance.models import AcceptanceRun, NodeAcceptanceBinding
from studio.apps.visual_workshop.canvas_values import canvas_out
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.outputs.recording import register_output
from studio.apps.visual_workshop.prompt_versions import preserve_legacy_prompt_versions
from studio.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
    VisualCanvasDocumentPutIn,
    VisualCanvasNode,
    VisualDesignReference,
    default_material_categories,
    design_category_kind,
    is_design_category,
)
from studio.apps.visual_workshop.storage.models import (
    VisualAssetCard,
    VisualCanvasDocument,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now


class VisualCanvasError(Exception):
    def __init__(self, message: str, *, code: str = "invalid_canvas", status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class CanvasDocuments:
    def __init__(self, session: AsyncSession, *, validate_assets) -> None:
        self.session = session
        self.validate_assets = validate_assets

    async def _row(self, project_id: str) -> VisualCanvasDocument:
        project = await self.session.get(VisualWorkshopProject, project_id)
        if project is None:
            raise VisualCanvasError("项目不存在", code="not_found", status=404)
        row = await self.session.get(VisualCanvasDocument, project_id)
        if row is None:
            raise VisualCanvasError("项目画布不存在", code="canvas_not_found", status=404)
        return row

    async def get(self, project_id: str) -> VisualCanvasDocumentOut:
        return canvas_out(await self._row(project_id))

    async def _validate_tasks(self, project_id: str, nodes: list[VisualCanvasNode]) -> None:
        expected = {
            node.generation_task_id: node.kind
            for node in nodes
            if node.kind in {"image", "video", "audio"} and node.generation_task_id is not None
        }
        if not expected:
            return
        rows = (
            (
                await self.session.execute(
                    select(VisualGenerationTask).where(VisualGenerationTask.id.in_(expected.keys()))
                )
            )
            .scalars()
            .all()
        )
        tasks = {row.id: row for row in rows}
        for task_id, kind in expected.items():
            task = tasks.get(task_id)
            if task is None:
                raise VisualCanvasError("节点生成任务不存在", code="task_not_found")
            if task.project_id != project_id or task.generation_kind != kind:
                raise VisualCanvasError("节点生成任务不属于当前项目", code="scope_mismatch")

    async def replace(
        self,
        project_id: str,
        body: VisualCanvasDocumentPutIn,
    ) -> VisualCanvasDocumentOut:
        row = await self._row(project_id)
        old = {node["id"]: node for node in row.nodes or []}
        for node in body.nodes:
            previous = old.get(node.id, {})
            if node.kind == "image" and node.asset_id == previous.get("asset_id"):
                if "design_card_id" not in node.model_fields_set:
                    node.design_card_id = previous.get("design_card_id")
                    node.design_card_revision = previous.get("design_card_revision")
            if node.kind == "video" and node.generation_draft:
                draft = node.generation_draft
                if "reference_subjects" not in draft.model_fields_set:
                    draft.reference_subjects = (previous.get("generation_draft") or {}).get(
                        "reference_subjects"
                    )
                if "reference_order" not in draft.model_fields_set:
                    draft.reference_order = (previous.get("generation_draft") or {}).get(
                        "reference_order"
                    )
                if "design_references" not in draft.model_fields_set:
                    assets = set(draft.reference_asset_ids)
                    draft.design_references = [
                        VisualDesignReference.model_validate(reference)
                        for reference in (previous.get("generation_draft") or {}).get(
                            "design_references", []
                        )
                        if reference["asset_id"] in assets
                    ]
        preserve_legacy_prompt_versions(body.nodes, row.nodes or [])
        await self.validate_assets(project_id, body.nodes, row.nodes or [])
        await self._validate_tasks(project_id, body.nodes)
        removed = set(old) - {node.id for node in body.nodes}
        if any(
            edge.get("source_node_id") in removed and edge.get("target_node_id") not in removed
            for edge in row.edges or []
        ):
            raise VisualCanvasError(
                "请先解除下游输入引用，再删除节点", code="node_in_use", status=409
            )
        for edge in body.edges:
            if edge.binding == "fixed":
                output = await self.session.get(VisualNodeOutput, edge.output_id)
                if (
                    output is None
                    or output.project_id != project_id
                    or output.node_id != edge.source_node_id
                ):
                    raise VisualCanvasError(
                        "输入版本不属于上游节点", code="invalid_output_reference"
                    )
        categories = (
            [category.model_dump(mode="json") for category in body.categories]
            if body.categories is not None
            else row.categories
        )
        known_categories = {
            item["id"]: item
            for item in (
                categories
                or [category.model_dump(mode="json") for category in default_material_categories()]
            )
        }
        old_categories = {
            item["id"]: item["name"]
            for item in (
                row.categories
                or [category.model_dump() for category in default_material_categories()]
            )
        }
        if any(
            is_design_category(item["id"], item["name"])
            and old_categories.get(item["id"]) != item["name"]
            for item in known_categories.values()
        ):
            raise VisualCanvasError("设定分类由设定库提供", code="design_card_required")
        group_values = (
            [group.model_dump(mode="json") for group in body.groups]
            if body.groups is not None
            else [
                {**group, "node_ids": members}
                for group in row.groups or []
                if len(members := [key for key in group["node_ids"] if key not in removed]) >= 2
            ]
        )
        project_card_ids = (
            body.project_card_ids
            if body.project_card_ids is not None
            else row.project_card_ids or []
        )
        new_cards = set(project_card_ids) - set(row.project_card_ids or [])
        new_cards.update(
            node.design_card_id
            for node in body.nodes
            if node.kind == "image"
            and node.design_card_id
            and node.design_card_id != old.get(node.id, {}).get("design_card_id")
        )
        previous_refs = {
            (ref["card_id"], ref["card_revision"], ref["asset_id"])
            for node in old.values()
            for ref in (node.get("generation_draft") or {}).get("design_references", [])
        }
        new_refs = {
            (ref.card_id, ref.card_revision, ref.asset_id)
            for node in body.nodes
            if node.kind == "video" and node.generation_draft
            for ref in node.generation_draft.design_references
        } - previous_refs
        attached_cards = {card_id for card_id, _, _ in new_refs}
        attached_cards.update(
            node.design_card_id
            for node in body.nodes
            if node.kind == "image"
            and node.design_card_id
            and node.design_card_id != old.get(node.id, {}).get("design_card_id")
        )
        if attached_cards - set(project_card_ids):
            raise VisualCanvasError("请先将设定卡收录到当前项目", code="project_card_required")
        new_cards.update(card_id for card_id, _, _ in new_refs)
        usable: dict[str, VisualAssetCard] = {}
        if new_cards:
            owner = await self.session.scalar(
                select(VisualWorkshopProject.owner_user_id).where(
                    VisualWorkshopProject.id == project_id
                )
            )
            cards = await self.session.scalars(
                select(VisualAssetCard).where(
                    VisualAssetCard.id.in_(new_cards), VisualAssetCard.owner_user_id == owner
                )
            )
            usable = {card.id: card for card in cards if not card.data.get("archived")}
            if usable.keys() != new_cards:
                raise VisualCanvasError("设定卡不可用或已归档", code="invalid_design_card")
            if any(
                usable[card_id].revision != revision
                or not usable[card_id].data.get("adopted_asset_id")
                for card_id, revision, _ in new_refs
            ):
                raise VisualCanvasError(
                    "设定卡已更新，请重新选择采用图", code="design_card_changed"
                )
        for node in body.nodes:
            category = known_categories.get(node.category_id, {})
            previous = old.get(node.id, {})
            if node.kind == "image" and node.design_card_id in usable:
                required_kind = design_category_kind(node.category_id, category.get("name", ""))
                if required_kind and usable[node.design_card_id].data.get("kind") != required_kind:
                    raise VisualCanvasError("请选择对应类型的设定卡", code="invalid_design_card")
            if is_design_category(node.category_id, category.get("name", "")) and (
                previous.get("category_id") != node.category_id
                or previous.get("group") != node.group
                or previous.get("asset_id") != getattr(node, "asset_id", None)
            ):
                raise VisualCanvasError(
                    "请从设定库引入角色、场景或道具", code="design_card_required"
                )
            if node.category_id and node.category_id not in known_categories:
                raise VisualCanvasError("节点分类不存在")
            if node.group and (
                not node.category_id
                or node.group not in known_categories[node.category_id]["groups"]
            ):
                raise VisualCanvasError("节点分组不存在")
            if node.id in old and node.kind != old[node.id]["kind"]:
                raise VisualCanvasError("已有节点不能改变媒体类型")
        now = utc_now()
        result = await self.session.execute(
            update(VisualCanvasDocument)
            .where(
                VisualCanvasDocument.project_id == project_id,
                VisualCanvasDocument.revision == body.expected_revision,
            )
            .values(
                edges=[edge.model_dump(mode="json") for edge in body.edges],
                categories=categories,
                groups=group_values,
                project_card_ids=project_card_ids,
                revision=body.expected_revision + 1,
                updated_at=now,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get(project_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                current.model_dump(mode="json"),
            )
        nodes = [node.model_dump(mode="json") for node in body.nodes]
        for node, incoming in zip(nodes, body.nodes, strict=True):
            previous = old.get(node["id"], {})
            if "approved" not in incoming.model_fields_set:
                node["approved"] = previous.get("approved", False)
            if node["kind"] == "text" and node.get("text") != previous.get("text"):
                node["approved"] = False
            # Output selection is server-owned. Canvas saves cannot forge version
            # identifiers or replace a chosen history item through a stale patch.
            node["output_sequence"] = previous.get("output_sequence", 0)
            node["final_output_id"] = previous.get("final_output_id")
            node["final_version"] = previous.get("final_version")
            if (
                node["kind"] != "text"
                and node.get("asset_id")
                and node.get("asset_id") != previous.get("asset_id")
            ):
                await register_output(
                    self.session,
                    project_id,
                    node,
                    source="uploaded",
                    source_key=new_id(),
                    asset_id=node["asset_id"],
                )
            elif (
                node["kind"] != "text"
                and not node.get("asset_id")
                and previous.get("final_output_id")
            ):
                node["asset_id"] = previous.get("asset_id")
        await self.session.execute(
            update(VisualCanvasDocument)
            .where(VisualCanvasDocument.project_id == project_id)
            .values(nodes=nodes)
        )
        if removed:
            from sqlalchemy import delete

            await self.session.execute(
                delete(NodeAcceptanceBinding).where(
                    NodeAcceptanceBinding.project_id == project_id,
                    NodeAcceptanceBinding.node_id.in_(removed),
                )
            )

            await self.session.execute(
                delete(VisualNodeOutput).where(
                    VisualNodeOutput.project_id == project_id,
                    VisualNodeOutput.node_id.in_(removed),
                    VisualNodeOutput.id.not_in(
                        select(AcceptanceRun.output_id).where(
                            AcceptanceRun.project_id == project_id
                        )
                    ),
                )
            )
        return await self.get(project_id)

    async def put(
        self,
        project_id: str,
        body: VisualCanvasDocumentPutIn,
    ) -> VisualCanvasDocumentOut:
        result = await self.replace(project_id, body)
        await self.session.commit()
        return result

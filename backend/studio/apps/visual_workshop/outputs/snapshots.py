"""Portable output histories, with independent identities in the imported project."""

from copy import deepcopy
from datetime import datetime

from pydantic import ValidationError
from sqlalchemy import select

from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.outputs.queries import output_out
from studio.apps.visual_workshop.outputs.schemas import VisualNodeOutputOut
from studio.runtime.files.project_archives import ProjectSnapshotError
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


async def export_outputs(session, project_id):
    rows = await session.scalars(
        select(VisualNodeOutput)
        .where(VisualNodeOutput.project_id == project_id)
        .order_by(VisualNodeOutput.node_id, VisualNodeOutput.version)
    )
    return [output_out(row).model_dump(mode="json") for row in rows]


def import_outputs(value, nodes, edges, asset_ids, project_id):
    if not isinstance(value, list):
        raise ProjectSnapshotError("节点输出历史必须是数组")
    original = {node["id"]: node for node in nodes}
    node_ids = {node_id: new_id() for node_id in original}
    output_ids, versions, records = {}, set(), []
    edge_ids = {edge["id"]: new_id() for edge in edges}
    try:
        for item in value:
            record = VisualNodeOutputOut.model_validate(item)
            if (
                record.id in output_ids
                or record.node_id not in original
                or record.version < 1
                or (record.node_id, record.version) in versions
                or record.kind != original[record.node_id]["kind"]
            ):
                raise ValueError("无效输出身份或版本")
            if record.kind == "text":
                if record.text is None or len(record.text) > 20000 or record.asset_id:
                    raise ValueError("无效文本版本")
            elif not record.asset_id or record.asset_id not in asset_ids:
                raise ValueError("历史素材未包含在快照中")
            if record.inspection_asset_id and (
                record.kind != "video" or record.inspection_asset_id not in asset_ids
            ):
                raise ValueError("检查素材未包含在快照中")
            datetime.fromisoformat(record.created_at.replace("Z", "+00:00"))
            versions.add((record.node_id, record.version))
            output_ids[record.id] = new_id()
            records.append(record)
    except (ValidationError, ValueError) as exc:
        raise ProjectSnapshotError("节点输出历史无效") from exc
    rows = []
    for record in records:
        snapshot = deepcopy(record.input_snapshot)
        for reference in snapshot:
            if reference.get("edge_id"):
                reference["edge_id"] = edge_ids.get(reference["edge_id"], reference["edge_id"])
            reference["node_id"] = node_ids.get(reference.get("node_id"), reference.get("node_id"))
            reference["output_id"] = output_ids.get(reference.get("output_id"))
            if reference.get("asset_id"):
                if reference["asset_id"] not in asset_ids:
                    raise ProjectSnapshotError("提交输入素材未包含在快照中")
                reference["asset_id"] = asset_ids[reference["asset_id"]]
        rows.append(
            VisualNodeOutput(
                id=output_ids[record.id],
                project_id=project_id,
                node_id=node_ids[record.node_id],
                version=record.version,
                kind=record.kind,
                asset_id=asset_ids.get(record.asset_id),
                inspection_asset_id=asset_ids.get(record.inspection_asset_id),
                text=record.text,
                source=record.source,
                source_key=f"snapshot:{output_ids[record.id]}",
                generation_task_id=record.generation_task_id,
                input_snapshot=snapshot,
                is_final=False,
                created_at=datetime.fromisoformat(record.created_at.replace("Z", "+00:00")).replace(
                    tzinfo=None
                ),
            )
        )
    for node in nodes:
        source_id = node["id"]
        final = node.get("final_output_id")
        candidates = [record for record in records if record.node_id == source_id]
        if final:
            record = next((record for record in candidates if record.id == final), None)
            if record is None:
                raise ProjectSnapshotError("最终版本不属于节点")
            node["final_output_id"], node["final_version"] = output_ids[final], record.version
            for row in rows:
                if row.id == output_ids[final]:
                    row.is_final = True
                    if row.asset_id:
                        node["asset_id"] = row.asset_id
        elif candidates:
            # Strict acceptance projects legitimately contain only candidates.
            if any(record.is_final for record in candidates):
                raise ProjectSnapshotError("节点历史缺少最终版本")
            node["asset_id"] = None if node["kind"] != "text" else node.get("asset_id")
        elif node.get("asset_id") or (node["kind"] == "text" and node.get("text")):
            # Old snapshot format: the current media/text has a provable owner.
            identity = new_id()
            rows.append(
                VisualNodeOutput(
                    id=identity,
                    project_id=project_id,
                    node_id=node_ids[source_id],
                    version=1,
                    kind=node["kind"],
                    asset_id=node.get("asset_id"),
                    text=node.get("text") if node["kind"] == "text" else None,
                    source="legacy",
                    source_key=f"snapshot:{identity}",
                    is_final=True,
                    input_snapshot=[],
                    created_at=utc_now(),
                )
            )
            node["final_output_id"], node["final_version"] = identity, 1
        node["output_sequence"] = max(
            (node.get("output_sequence") or 0),
            *([record.version for record in candidates] or [node.get("final_version") or 0]),
        )
        node["id"] = node_ids[source_id]
    for edge in edges:
        edge["id"] = edge_ids[edge["id"]]
        edge["source_node_id"] = node_ids[edge["source_node_id"]]
        edge["target_node_id"] = node_ids[edge["target_node_id"]]
        if edge.get("binding") == "fixed":
            source = next(
                (record for record in records if record.id == edge.get("output_id")), None
            )
            if not source or node_ids[source.node_id] != edge["source_node_id"]:
                raise ProjectSnapshotError("固定引用版本不属于上游节点")
            edge["output_id"] = output_ids[edge["output_id"]]
    return rows

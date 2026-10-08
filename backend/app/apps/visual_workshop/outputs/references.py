from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.visual_workshop.models import VisualCanvasDocument
from app.apps.visual_workshop.outputs.history import OutputError
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.llm.schemas.generation_tasks import (
    AudioGenerationTaskCreateIn,
    ImageGenerationTaskCreateIn,
)


async def resolve_references(session: AsyncSession, project_id: str, body):
    if body.canvas_node_id is None:
        return body, {}, []
    canvas = await session.get(VisualCanvasDocument, project_id)
    if canvas is None:
        raise OutputError("项目画布不存在", code="canvas_not_found", status=404)
    if canvas.revision != body.expected_canvas_revision:
        raise OutputError("画布已变化，请刷新后重试", code="canvas_revision_conflict", status=409)
    nodes = {node["id"]: node for node in canvas.nodes}
    target = nodes.get(body.canvas_node_id)
    if target is None or target["kind"] != body.kind:
        raise OutputError("生成节点不存在或类型不匹配", code="canvas_kind_mismatch")
    payload = body.model_dump(mode="json")
    linked = {"image": [], "video": [], "audio": []}
    titles, snapshot, contexts = {}, [], []
    for edge in canvas.edges or []:
        if edge["target_node_id"] != body.canvas_node_id:
            continue
        source = nodes[edge["source_node_id"]]
        output_id = (
            edge.get("output_id")
            if edge.get("binding") == "fixed"
            else source.get("final_output_id")
        )
        output = await session.get(VisualNodeOutput, output_id) if output_id else None
        if output and (output.project_id != project_id or output.node_id != source["id"]):
            raise OutputError("输入版本不属于上游节点")
        if output_id and not output:
            raise OutputError("引用的输出版本不存在", code="upstream_output_missing", status=409)
        # Old canvas documents may predate explicit output history.
        asset_id = output.asset_id if output else source.get("asset_id")
        text = output.text if output else None
        if source["kind"] == "text":
            if not text:
                raise OutputError("上游文本尚无输出", code="upstream_asset_pending", status=409)
            contexts.append(f"【{source['title']}】\n{text}")
        elif not asset_id:
            raise OutputError(
                f"上游节点“{source['title']}”正在等待素材",
                code="upstream_asset_pending",
                status=409,
            )
        elif body.kind == "video" and edge.get("purpose") in {"first_frame", "last_frame"}:
            if source["kind"] != "image":
                raise OutputError("首尾帧输入必须是图片")
            field = f"{edge['purpose']}_asset_id"
            if payload.get(field) and payload[field] != asset_id:
                raise OutputError("首尾帧输入不能重复")
            payload[field] = asset_id
        else:
            linked[source["kind"]].append(asset_id)
        if asset_id:
            titles[asset_id] = source["title"]
        snapshot.append(
            {
                "edge_id": edge["id"],
                "node_id": source["id"],
                "binding": edge.get("binding", "final"),
                "purpose": edge.get("purpose", "reference"),
                "output_id": output_id,
                "version": output.version if output else None,
                "asset_id": asset_id,
                "text": text if source["kind"] == "text" else None,
            }
        )
    if contexts:
        payload["prompt"] = "\n\n".join([payload["prompt"], *contexts]).strip()
    if isinstance(body, ImageGenerationTaskCreateIn):
        references = [
            *body.reference_asset_ids,
            *([body.reference_asset_id] if body.reference_asset_id else []),
            *linked["image"],
        ]
        payload["reference_asset_ids"] = list(dict.fromkeys(references))
        payload["reference_asset_id"] = None
    elif isinstance(body, AudioGenerationTaskCreateIn):
        payload["reference_asset_ids"] = list(
            dict.fromkeys([*body.reference_asset_ids, *linked["audio"]])
        )
    else:
        for kind, field in (
            ("image", "reference_asset_ids"),
            ("video", "video_asset_ids"),
            ("audio", "audio_asset_ids"),
        ):
            payload[field] = list(dict.fromkeys([*payload[field], *linked[kind]]))
        if payload.get("first_frame_asset_id") or payload.get("last_frame_asset_id"):
            payload["mode"] = "frames"
        elif any(
            payload[field]
            for field in ("reference_asset_ids", "video_asset_ids", "audio_asset_ids")
        ):
            payload["mode"] = "reference"
    own_asset_id = target.get("asset_id")
    reference_ids = [
        *payload.get("reference_asset_ids", []),
        *payload.get("video_asset_ids", []),
        *payload.get("audio_asset_ids", []),
        payload.get("reference_asset_id"),
        payload.get("first_frame_asset_id"),
        payload.get("last_frame_asset_id"),
    ]
    if own_asset_id and own_asset_id in reference_ids:
        raise OutputError("素材不能引用自身", code="self_asset_reference")
    return type(body).model_validate(payload), titles, snapshot

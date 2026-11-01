"""Resolve and freeze inputs from the output's generation provenance, never from its pixels."""

import hashlib
import json
from copy import deepcopy

from sqlalchemy import select

from app.apps.visual_workshop.models import VisualCanvasDocument, VisualGenerationTask
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.config import get_settings

from .access import AcceptanceError, asset, project
from .catalog import (
    AGENT_REPORT_VERSION,
    API_RESULT_VERSION,
    INPUT_VERSION,
    SCHEME_VERSION,
    TEMPLATE_VERSION,
)
from .node_schemas import AcceptanceInputOut
from .templates import builtin_templates


def fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def specifications(data):
    result = {}
    if data.get("ratio") in {"16:9", "9:16", "4:3", "3:4", "1:1", "21:9"}:
        result["ratio"] = data["ratio"]
        resolution = {"480p": 480, "720p": 720, "1080p": 1080, "4k": 2160}.get(
            data.get("resolution")
        )
        if resolution:
            x, y = map(int, result["ratio"].split(":"))
            result.update(
                min_width=round(resolution * x / min(x, y)),
                min_height=round(resolution * y / min(x, y)),
            )
    duration = data.get("duration")
    if isinstance(duration, (int, float)) and duration > 0:
        result.update(min_duration=max(0, duration - 0.25), max_duration=duration + 0.25)
    if data.get("generate_audio") is True:
        result["require_audio"] = True
    return result


async def resolve_context(session, owner_user_id, project_id, node_id, scheme_id, output_id=None):
    await project(session, owner_user_id, project_id)
    canvas = await session.get(VisualCanvasDocument, project_id)
    node = next((item for item in canvas.nodes if item["id"] == node_id), None) if canvas else None
    if not node:
        raise AcceptanceError("节点不存在", "not_found", 404)
    query = select(VisualNodeOutput).where(
        VisualNodeOutput.project_id == project_id, VisualNodeOutput.node_id == node_id
    )
    if output_id:
        query = query.where(VisualNodeOutput.id == output_id)
    output = await session.scalar(query.order_by(VisualNodeOutput.version.desc()).limit(1))
    if output_id and output is None:
        raise AcceptanceError("输出版本不存在", "not_found", 404)
    issues = []
    if node["kind"] != "video":
        issues.append("动作迁移模板仅适用于视频节点")
    if output is None:
        issues.append("当前节点暂无输出，请先生成或上传视频")
    data = dict(node.get("generation_draft") or {})
    source = "node_settings"
    input_snapshot = []
    if output and output.generation_task_id:
        task = await session.scalar(
            select(VisualGenerationTask).where(
                VisualGenerationTask.id == output.generation_task_id,
                VisualGenerationTask.project_id == project_id,
                VisualGenerationTask.owner_user_id == owner_user_id,
            )
        )
        if task:
            data = dict(task.request_payload or {})
            input_snapshot = deepcopy(output.input_snapshot or data.get("input_snapshot", []))
            source = "generation_snapshot"
        else:
            data = {}
            issues.append("该输出的生成依据已不可用，不能用当前草稿替代旧生成记录")
            source = "generation_snapshot_missing"
    elif output:
        input_snapshot = deepcopy(output.input_snapshot or [])
    # Uploaded outputs use saved node references, including explicit upstream version bindings.
    if output and not output.generation_task_id:
        nodes = {item["id"]: item for item in canvas.nodes}
        for edge in canvas.edges or []:
            if edge["target_node_id"] != node_id:
                continue
            upstream = nodes.get(edge["source_node_id"], {})
            identity = (
                edge.get("output_id")
                if edge.get("binding") == "fixed"
                else upstream.get("final_output_id")
            )
            previous = await session.get(VisualNodeOutput, identity) if identity else None
            if previous and (
                previous.project_id != project_id or previous.node_id != upstream.get("id")
            ):
                raise AcceptanceError("输入版本不属于当前项目节点", "not_found", 404)
            input_snapshot.append(
                {
                    "asset_id": previous.asset_id if previous else upstream.get("asset_id"),
                    "purpose": edge.get("purpose", "reference"),
                    "output_id": identity,
                    "text": previous.text if previous else None,
                }
            )
    images = list(data.get("reference_asset_ids") or [])
    images += [
        data[key]
        for key in ("reference_asset_id", "first_frame_asset_id", "last_frame_asset_id")
        if data.get(key)
    ]
    videos = list(data.get("video_asset_ids") or [])
    refs = list(
        dict.fromkeys(
            [
                *images,
                *videos,
                *[item["asset_id"] for item in input_snapshot if item.get("asset_id")],
            ]
        )
    )
    if len(refs) > 40:
        issues.append("参考素材超过 40 项，请在生成设置中整理后再验收")
        refs = refs[:40]
    inputs, character, motion = [], [], []
    storage = AssetStorage(get_settings())
    for identity in refs:
        if output and identity == output.asset_id:
            issues.append("当前输出不能同时作为自身的验收参考")
            continue
        try:
            row = await asset(session, owner_user_id, project_id, identity)
        except AcceptanceError as exc:
            if exc.status != 404:
                raise
            issues.append(f"参考素材 {identity} 已不可用，请在生成设置中补齐")
            continue
        if row.media_kind not in {"image", "video"}:
            continue
        role = "character" if row.media_kind == "image" else "motion"
        (character if role == "character" else motion).append(identity)
        inputs.append(
            AcceptanceInputOut(
                asset_id=identity,
                label=row.display_name or row.original_filename,
                kind=row.media_kind,
                role=role,
            )
        )
        if not storage.path_for(row).is_file():
            issues.append(f"参考素材无法读取：{row.display_name or row.original_filename}")
    if not character:
        issues.append("缺少角色基准图，请在生成设置中添加参考图片")
    if not motion:
        issues.append("缺少原动作视频，请在生成设置中添加参考视频")
    if output and output.asset_id:
        row = await asset(session, owner_user_id, project_id, output.asset_id)
        if row.media_kind == "video":
            inputs.append(
                AcceptanceInputOut(
                    asset_id=row.id,
                    label=row.display_name or row.original_filename,
                    kind="video",
                    role="output",
                )
            )
        if not storage.path_for(row).is_file():
            issues.append("当前输出文件无法读取")
    criteria = [item.model_copy(deep=True) for item in builtin_templates()[0].document.criteria]
    specs = specifications(data)
    criteria[0].specifications = criteria[0].specifications.model_validate(specs)
    criteria[1].reference_asset_ids = character
    criteria[2].reference_asset_ids = motion
    criteria[3].reference_asset_ids = motion
    for criterion in criteria:
        criterion.kinds = ["video"]
    prompt = data.get("prompt", "")
    if source == "node_settings":
        context_text = [item["text"] for item in input_snapshot if item.get("text")]
        prompt = "\n\n".join([prompt, *context_text]).strip()
    snapshot = {
        "standard_version": TEMPLATE_VERSION,
        "standard_title": "动作迁移",
        "scheme_id": scheme_id or "",
        "inputs_version": INPUT_VERSION,
        "scheme_version": SCHEME_VERSION,
        "result_contract_version": API_RESULT_VERSION
        if scheme_id == "motion-transfer:api"
        else AGENT_REPORT_VERSION,
        "input_source": source,
        "criteria": [item.model_dump(mode="json") for item in criteria],
        "prompt": prompt,
        "inputs": {"assets": [item.model_dump() for item in inputs], "provenance": input_snapshot},
        "output": {
            "id": output.id,
            "kind": output.kind,
            "version": output.version,
            "asset_id": output.asset_id,
            "text": output.text,
            "title": node["title"],
        }
        if output
        else None,
        "coverage": "视频仅进行有界抽帧辅助检查；连续动作、节奏和音画同步需人工播放确认。",
    }
    digest = fingerprint(snapshot)
    snapshot["context_fingerprint"] = digest
    return canvas, node, output, inputs, specs, issues, snapshot

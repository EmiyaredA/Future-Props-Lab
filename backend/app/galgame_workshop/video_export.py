from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.db import SessionLocal
from app.core.tenant_context import bind_workspace
from app.core.time import iso_utc, utc_now
from app.files import AssetError
from app.files.library import AssetLibrary
from app.files.storage import AssetStorage
from app.galgame_workshop.story import GalgameStoryDocuments
from app.llm.generation_runtime import PollingGenerationRunner
from app.models import (
    GalgameAssetMetadata,
    GalgameProjectAssetReference,
    GalgameStorySnapshot,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
    VisualAsset,
)
from app.schemas.galgame_workshop import (
    GalgameVideoExportChoiceOut,
    GalgameVideoExportCreateIn,
    GalgameVideoExportDecisionOut,
    GalgameVideoExportIssue,
    GalgameVideoExportPreviewIn,
    GalgameVideoExportPreviewOut,
    GalgameVideoExportRouteOut,
    GalgameVideoExportTaskListOut,
    GalgameVideoExportTaskOut,
)

PRESETS = {
    "1080p30": (1920, 1080, 30),
    "720p30": (1280, 720, 30),
    "1080p60": (1920, 1080, 60),
}
CHOICE_DURATION_MS = 2000
CHOICE_HIGHLIGHT_MS = 500
MAX_ROUTE_STEPS = 20_000
EXPORT_PACKAGING_POLICY = "include"


def _task_out(row: GalgameVideoExportTask) -> GalgameVideoExportTaskOut:
    result = dict(row.result_detail or {})
    phase = result.get("phase")
    if phase not in {
        "queued",
        "preparing",
        "rendering",
        "encoding",
        "verifying",
        "registering",
        "completed",
        "failed",
        "cancelled",
    }:
        phase = "rendering" if row.status == "running" else row.status
    return GalgameVideoExportTaskOut(
        id=row.id,
        projectId=row.project_id,
        requestId=row.request_id,
        storyRevision=row.story_revision,
        status=row.status,
        phase=phase,
        progress=row.progress,
        renderedMs=max(0, int(result.get("renderedMs", 0))),
        totalMs=max(0, int(result.get("totalMs", 0))),
        preset=row.request_payload.get("preset", "1080p30"),
        endingLabel=str(result.get("endingLabel", "")),
        outputAssetId=row.output_asset_id,
        outputFilename=result.get("outputFilename"),
        error=row.error,
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        updatedAt=iso_utc(row.updated_at),
        startedAt=iso_utc(row.started_at) if row.started_at else None,
        finishedAt=iso_utc(row.finished_at) if row.finished_at else None,
    )


@dataclass
class _RoutePlan:
    chapter_ids: list[str] = field(default_factory=list)
    fragment_ids: list[str] = field(default_factory=list)
    branch_block_ids: list[str] = field(default_factory=list)
    duration_ms: int = 0
    exact_duration: bool = True
    ending_label: str = "故事结束"
    decision: dict[str, Any] | None = None
    blockers: list[GalgameVideoExportIssue] = field(default_factory=list)
    warnings: list[GalgameVideoExportIssue] = field(default_factory=list)
    used_selections: set[str] = field(default_factory=set)


_TOKEN = re.compile(
    r"\s*(?:(?P<string>\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*')|"
    r"(?P<number>-?\d+(?:\.\d+)?)|(?P<operator>===|!==|==|!=|>=|<=|&&|\|\||>|<|!)|"
    r"(?P<paren>[()])|(?P<identifier>[a-zA-Z_][a-zA-Z0-9_.-]*))"
)


def _evaluate_expression(source: str, values: dict[str, Any]) -> bool:
    tokens: list[tuple[str, str]] = []
    position = 0
    while position < len(source):
        match = _TOKEN.match(source, position)
        if not match:
            raise ValueError(f"条件表达式包含不支持的字符：{source[position]}")
        kind = next(key for key, value in match.groupdict().items() if value is not None)
        tokens.append((kind, match.group(kind)))
        position = match.end()
    cursor = 0

    def primary() -> Any:
        nonlocal cursor
        if cursor >= len(tokens):
            raise ValueError("条件表达式不完整")
        kind, value = tokens[cursor]
        cursor += 1
        if kind == "paren" and value == "(":
            result = parse_or()
            if cursor >= len(tokens) or tokens[cursor][1] != ")":
                raise ValueError("条件表达式缺少右括号")
            cursor += 1
            return result
        if kind == "number":
            return float(value) if "." in value else int(value)
        if kind == "string":
            if value.startswith("'"):
                value = json.dumps(value[1:-1].replace("\\'", "'"))
            return json.loads(value)
        if kind != "identifier":
            raise ValueError("条件表达式需要变量或常量")
        if value == "true":
            return True
        if value == "false":
            return False
        if value not in values:
            raise ValueError(f"未声明的变量：{value}")
        return values[value]

    def unary() -> Any:
        nonlocal cursor
        if cursor < len(tokens) and tokens[cursor][1] == "!":
            cursor += 1
            return not bool(unary())
        return primary()

    def comparison() -> Any:
        nonlocal cursor
        left = unary()
        if cursor >= len(tokens) or tokens[cursor][1] not in {
            "===",
            "!==",
            "==",
            "!=",
            ">",
            "<",
            ">=",
            "<=",
        }:
            return left
        operator = tokens[cursor][1]
        cursor += 1
        right = unary()
        if operator in {"==", "==="}:
            return type(left) is type(right) and left == right
        if operator in {"!=", "!=="}:
            return not (type(left) is type(right) and left == right)
        if (
            not isinstance(left, (int, float))
            or isinstance(left, bool)
            or not isinstance(right, (int, float))
            or isinstance(right, bool)
        ):
            raise ValueError("大小比较只支持数值变量")
        return {">": left > right, "<": left < right, ">=": left >= right, "<=": left <= right}[
            operator
        ]

    def parse_and() -> Any:
        nonlocal cursor
        value = comparison()
        while cursor < len(tokens) and tokens[cursor][1] == "&&":
            cursor += 1
            right = comparison()
            value = bool(value) and bool(right)
        return value

    def parse_or() -> Any:
        nonlocal cursor
        value = parse_and()
        while cursor < len(tokens) and tokens[cursor][1] == "||":
            cursor += 1
            right = parse_and()
            value = bool(value) or bool(right)
        return value

    result = bool(parse_or())
    if cursor != len(tokens):
        raise ValueError("条件表达式存在多余内容")
    return result


def _content_text(block: dict[str, Any]) -> str:
    if isinstance(block.get("text"), str):
        return block["text"]
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return str(content.get("text", ""))
    return ""


def _estimate_block_ms(block: dict[str, Any], asset_duration: dict[str, int]) -> tuple[int, bool]:
    block_type = block.get("type")
    if block_type in {"dialogue", "narration", "storyParagraph", "floatingText"}:
        voice_id = block.get("voiceAssetId")
        if voice_id and voice_id in asset_duration:
            return asset_duration[voice_id] + 400, False
        speed = max(1, int(block.get("textSpeedCps") or 40))
        return max(400, round(len(_content_text(block)) / speed * 1000) + 400), False
    if block_type == "wait":
        if block.get("mode") == "player":
            return 1200, False
        return max(0, int(block.get("durationMs", 0))), True
    if block_type == "systemMessage":
        return 1200, False
    if block.get("waitForCompletion") and isinstance(block.get("durationMs"), int):
        return max(0, block["durationMs"]), True
    return 0, True


def _plan_route(
    document: dict[str, Any],
    selections: dict[str, str],
    asset_duration: dict[str, int],
) -> _RoutePlan:
    plan = _RoutePlan()
    chapters = sorted(
        [chapter for chapter in document.get("chapters", []) if not chapter.get("disabled")],
        key=lambda chapter: chapter.get("order", 0),
    )
    chapter_by_id = {chapter["id"]: chapter for chapter in chapters}
    chapter_id = document.get("entryChapterId")
    chapter = chapter_by_id.get(chapter_id)
    if chapter is None:
        plan.blockers.append(
            GalgameVideoExportIssue(
                code="missing_entry", message="项目入口章节不存在", path="/entryChapterId"
            )
        )
        return plan
    fragment_id = chapter.get("entryFragmentId")
    block_index = 0
    call_stack: list[tuple[str, str, int]] = []
    variables = {item["id"]: item.get("defaultValue") for item in document.get("variables", [])}
    for character in document.get("characters", []):
        for attribute_id, value in character.get("attributes", {}).items():
            variables[f"character.{character['id']}.{attribute_id}"] = value
    timed_fragments: set[tuple[str, str, int]] = set()

    def enter(target: str) -> None:
        nonlocal fragment_id, block_index
        call_stack.append((chapter_id, fragment_id, block_index + 1))
        fragment_id = target
        block_index = 0

    for _step in range(MAX_ROUTE_STEPS):
        chapter = chapter_by_id.get(chapter_id)
        fragments = {item["id"]: item for item in (chapter or {}).get("fragments", [])}
        fragment = fragments.get(fragment_id)
        if chapter is None or fragment is None:
            plan.blockers.append(
                GalgameVideoExportIssue(
                    code="missing_fragment",
                    message="路线引用了不存在的章节或 Fragment",
                    path=f"/chapters/{chapter_id}/fragments/{fragment_id}",
                )
            )
            return plan
        if not plan.chapter_ids or plan.chapter_ids[-1] != chapter_id:
            plan.chapter_ids.append(chapter_id)
        if not plan.fragment_ids or plan.fragment_ids[-1] != fragment_id:
            plan.fragment_ids.append(fragment_id)
        timeline = fragment.get("timeline")
        visit = (chapter_id, fragment_id, len(call_stack))
        if timeline and visit not in timed_fragments:
            plan.duration_ms += max(0, int(timeline.get("durationMs", 0)))
            timed_fragments.add(visit)
            terminator = next(
                (
                    (index, item)
                    for index, item in enumerate(fragment.get("blocks", []))
                    if item.get("type") in {"branch", "endChapter"}
                ),
                None,
            )
            block_index = terminator[0] if terminator else len(fragment.get("blocks", []))
        blocks = fragment.get("blocks", [])
        if block_index >= len(blocks):
            if call_stack:
                chapter_id, fragment_id, block_index = call_stack.pop()
                continue
            plan.ending_label = "故事结束"
            break
        block = blocks[block_index]
        block_type = block.get("type")
        block_id = block.get("id", f"block-{block_index}")
        if block_type == "branch":
            if block_id in plan.branch_block_ids:
                plan.blockers.append(
                    GalgameVideoExportIssue(
                        code="repeated_branch",
                        message="所选路线重复回到同一分支，无法生成有限视频",
                        path=f"/blocks/{block_id}",
                    )
                )
                return plan
            plan.branch_block_ids.append(block_id)
            chosen_id = selections.get(block_id)
            choice = next(
                (item for item in block.get("choices", []) if item.get("id") == chosen_id),
                None,
            )
            if choice is None:
                if chosen_id is not None:
                    plan.blockers.append(
                        GalgameVideoExportIssue(
                            code="invalid_choice",
                            message="分支选择已失效，请重新选择",
                            path=f"/blocks/{block_id}",
                        )
                    )
                plan.decision = block
                return plan
            plan.used_selections.add(block_id)
            plan.duration_ms += CHOICE_DURATION_MS
            enter(choice["targetFragmentId"])
            continue
        if block_type == "setVariable":
            variable_id = block.get("variableId")
            current = variables.get(variable_id)
            value = block.get("value")
            operator = block.get("operator", "set")
            if operator == "toggle":
                value = not bool(current)
            elif isinstance(current, (int, float)) and isinstance(value, (int, float)):
                if operator == "add":
                    value = current + value
                elif operator == "subtract":
                    value = current - value
                elif operator == "multiply":
                    value = current * value
                elif operator == "divide":
                    value = current if value == 0 else current / value
            variables[variable_id] = value
            block_index += 1
            continue
        if block_type == "if":
            try:
                matched = _evaluate_expression(str(block.get("condition", "")), variables)
            except ValueError as exc:
                plan.blockers.append(
                    GalgameVideoExportIssue(
                        code="invalid_condition", message=str(exc), path=f"/blocks/{block_id}"
                    )
                )
                return plan
            target = block.get("thenFragmentId") if matched else block.get("elseFragmentId")
            if target:
                enter(target)
            else:
                block_index += 1
            continue
        if block_type == "callFragment":
            enter(block["targetFragmentId"])
            continue
        if block_type == "endChapter":
            current_index = next(
                (index for index, item in enumerate(chapters) if item["id"] == chapter_id), -1
            )
            next_chapter = (
                chapters[current_index + 1] if current_index + 1 < len(chapters) else None
            )
            if next_chapter is None:
                plan.ending_label = block.get("label") or "故事结束"
                break
            chapter_id = next_chapter["id"]
            fragment_id = next_chapter["entryFragmentId"]
            block_index = 0
            call_stack.clear()
            continue
        if block_type == "returnToEntry":
            plan.blockers.append(
                GalgameVideoExportIssue(
                    code="return_to_entry_loop",
                    message="路线返回项目入口，无法确定有限导出时长",
                    path=f"/blocks/{block_id}",
                )
            )
            return plan
        duration, exact = _estimate_block_ms(block, asset_duration)
        plan.duration_ms += duration
        plan.exact_duration = plan.exact_duration and exact
        block_index += 1
    else:
        plan.blockers.append(
            GalgameVideoExportIssue(
                code="route_step_limit",
                message="路线执行超过安全步数，请检查递归或循环",
                path="/chapters",
            )
        )
    for branch_id in sorted(set(selections) - plan.used_selections):
        plan.warnings.append(
            GalgameVideoExportIssue(
                code="unused_selection",
                message="有一项分支选择不在当前路线中，已忽略",
                path=f"/branchSelections/{branch_id}",
            )
        )
    return plan


class GalgameVideoExports:
    def __init__(self, session: AsyncSession, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)

    async def _project(self, project_id: str) -> GalgameWorkshopProject:
        project = await self.session.get(GalgameWorkshopProject, project_id)
        if project is None:
            raise AssetError("Galgame 项目不存在", code="not_found", status=404)
        return project

    async def preview(
        self, project_id: str, body: GalgameVideoExportPreviewIn
    ) -> GalgameVideoExportPreviewOut:
        await self._project(project_id)
        story = await GalgameStoryDocuments(self.session).get(project_id)
        blockers: list[GalgameVideoExportIssue] = []
        warnings: list[GalgameVideoExportIssue] = []
        if story.revision != body.expected_story_revision:
            blockers.append(
                GalgameVideoExportIssue(
                    code="story_revision_conflict",
                    message=f"Story 已更新到 revision {story.revision}，请刷新后重新预览",
                    path="/expectedStoryRevision",
                )
            )
        document = story.document.model_dump(mode="json", by_alias=True)
        asset_duration: dict[str, int] = {}
        assets_by_file: dict[str, VisualAsset] = {}
        file_ids = [item.get("fileId") for item in document.get("assets", []) if item.get("fileId")]
        if file_ids:
            rows = list(
                (
                    await self.session.execute(
                        select(VisualAsset).where(VisualAsset.id.in_(file_ids))
                    )
                ).scalars()
            )
            assets_by_file = {item.id: item for item in rows}
            metadata_rows = list(
                (
                    await self.session.execute(
                        select(GalgameAssetMetadata).where(
                            GalgameAssetMetadata.asset_id.in_(file_ids)
                        )
                    )
                ).scalars()
            )
            metadata_by_file = {item.asset_id: item for item in metadata_rows}
            for story_asset in document.get("assets", []):
                file_id = story_asset.get("fileId")
                metadata = metadata_by_file.get(file_id)
                if metadata and metadata.duration_ms is not None:
                    asset_duration[story_asset["id"]] = metadata.duration_ms
        for index, story_asset in enumerate(document.get("assets", [])):
            file_id = story_asset.get("fileId")
            asset = assets_by_file.get(file_id)
            if asset is None or not self.storage.path_for(asset).is_file():
                blockers.append(
                    GalgameVideoExportIssue(
                        code="missing_asset",
                        message=f"素材“{story_asset.get('label') or story_asset.get('id')}”不可用",
                        path=f"/assets/{index}",
                    )
                )
        for program in ("node", "ffmpeg", "ffprobe"):
            if shutil.which(program) is None:
                blockers.append(
                    GalgameVideoExportIssue(
                        code="renderer_dependency_missing",
                        message=f"视频导出缺少运行程序：{program}",
                        path="/renderer",
                    )
                )
        render_script = (
            Path(__file__).resolve().parents[3] / "web" / "scripts" / "render-galgame-video.mjs"
        )
        if not render_script.is_file():
            blockers.append(
                GalgameVideoExportIssue(
                    code="renderer_missing",
                    message="Galgame 视频渲染器尚未安装",
                    path="/renderer",
                )
            )
        selections = {item.branch_block_id: item.choice_id for item in body.branch_selections}
        plan = _plan_route(document, selections, asset_duration)
        blockers.extend(plan.blockers)
        warnings.extend(plan.warnings)
        bitrate_mbps = 6 if body.preset == "720p30" else (18 if body.preset == "1080p60" else 10)
        estimated_work_bytes = max(
            2 * 1024 * 1024 * 1024,
            round(plan.duration_ms / 1000 * bitrate_mbps * 1_000_000 / 8 * 3),
        )
        try:
            free_bytes = shutil.disk_usage(self.settings.runtime_path).free
        except OSError:
            free_bytes = 0
        if free_bytes < estimated_work_bytes:
            blockers.append(
                GalgameVideoExportIssue(
                    code="insufficient_disk_space",
                    message="可用磁盘空间不足以安全完成本次视频导出",
                    path="/renderer/disk",
                )
            )
        decision = None
        if plan.decision is not None:
            decision = GalgameVideoExportDecisionOut(
                branchBlockId=plan.decision["id"],
                prompt=plan.decision.get("prompt", ""),
                choices=[
                    GalgameVideoExportChoiceOut(
                        id=item["id"],
                        text=item.get("text", ""),
                        targetFragmentId=item["targetFragmentId"],
                    )
                    for item in plan.decision.get("choices", [])
                ],
            )
        width, height, fps = PRESETS[body.preset]
        route = GalgameVideoExportRouteOut(
            chapterIds=plan.chapter_ids,
            fragmentIds=plan.fragment_ids,
            branchBlockIds=plan.branch_block_ids,
            endingLabel=plan.ending_label,
            estimatedDurationMs=plan.duration_ms,
            exactDuration=plan.exact_duration,
        )
        fingerprint_payload = {
            "storyRevision": story.revision,
            "locale": body.locale,
            "preset": body.preset,
            "branchSelections": [
                item.model_dump(mode="json", by_alias=True) for item in body.branch_selections
            ],
            "route": route.model_dump(mode="json", by_alias=True),
            "decision": decision.model_dump(mode="json", by_alias=True) if decision else None,
        }
        fingerprint = hashlib.sha256(
            json.dumps(fingerprint_payload, ensure_ascii=False, sort_keys=True).encode()
        ).hexdigest()
        return GalgameVideoExportPreviewOut(
            ready=not blockers and decision is None,
            storyRevision=story.revision,
            preset=body.preset,
            width=width,
            height=height,
            fps=fps,
            previewFingerprint=fingerprint,
            route=route,
            nextDecision=decision,
            blockers=blockers,
            warnings=warnings,
        )

    async def create(
        self, project_id: str, body: GalgameVideoExportCreateIn
    ) -> GalgameVideoExportTaskOut:
        await self._project(project_id)
        payload = body.model_dump(mode="json", by_alias=True)
        existing = await self.session.scalar(
            select(GalgameVideoExportTask).where(
                GalgameVideoExportTask.project_id == project_id,
                GalgameVideoExportTask.request_id == body.request_id,
            )
        )
        if existing is not None:
            if existing.request_payload != payload:
                raise AssetError(
                    "同一 requestId 已用于不同导出请求",
                    code="idempotency_conflict",
                    status=409,
                )
            return _task_out(existing)
        preview_body = GalgameVideoExportPreviewIn.model_validate(
            body.model_dump(mode="json", by_alias=True)
        )
        preview = await self.preview(project_id, preview_body)
        if preview.preview_fingerprint != body.preview_fingerprint:
            raise AssetError(
                "导出预览已失效，请重新预览路线",
                code="preview_conflict",
                status=409,
                detail={"preview": preview.model_dump(mode="json", by_alias=True)},
            )
        if not preview.ready:
            raise AssetError(
                "视频导出预览未通过",
                code="video_export_not_ready",
                detail={"preview": preview.model_dump(mode="json", by_alias=True)},
            )
        story = await GalgameStoryDocuments(self.session).get(project_id)
        snapshot = GalgameStorySnapshot(
            project_id=project_id,
            story_revision=story.revision,
            reason="video-export",
            document=story.document.model_dump(mode="json", by_alias=True),
        )
        self.session.add(snapshot)
        await self.session.flush()
        task = GalgameVideoExportTask(
            project_id=project_id,
            snapshot_id=snapshot.id,
            request_id=body.request_id,
            story_revision=story.revision,
            request_payload=payload,
            result_detail={
                "phase": "queued",
                "renderedMs": 0,
                "totalMs": preview.route.estimated_duration_ms,
                "endingLabel": preview.route.ending_label,
            },
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return _task_out(task)

    async def list(self, project_id: str) -> GalgameVideoExportTaskListOut:
        await self._project(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(GalgameVideoExportTask)
                    .where(GalgameVideoExportTask.project_id == project_id)
                    .order_by(GalgameVideoExportTask.created_at.desc())
                    .limit(50)
                )
            ).scalars()
        )
        return GalgameVideoExportTaskListOut(items=[_task_out(row) for row in rows])

    async def get(self, project_id: str, export_id: str) -> GalgameVideoExportTaskOut:
        await self._project(project_id)
        task = await self.session.get(GalgameVideoExportTask, export_id)
        if task is None or task.project_id != project_id:
            raise AssetError("视频导出任务不存在", code="not_found", status=404)
        return _task_out(task)

    async def cancel(self, project_id: str, export_id: str) -> GalgameVideoExportTaskOut:
        await self._project(project_id)
        task = await self.session.get(GalgameVideoExportTask, export_id)
        if task is None or task.project_id != project_id:
            raise AssetError("视频导出任务不存在", code="not_found", status=404)
        if task.status in {"completed", "failed", "cancelled"}:
            return _task_out(task)
        task.cancel_requested = True
        task.revision += 1
        task.updated_at = utc_now()
        if task.status == "queued":
            task.status = "cancelled"
            task.progress = 0
            task.result_detail = {**(task.result_detail or {}), "phase": "cancelled"}
            task.finished_at = utc_now()
        await self.session.commit()
        await self.session.refresh(task)
        return _task_out(task)

    async def output(self, project_id: str, export_id: str) -> tuple[VisualAsset, Path]:
        await self._project(project_id)
        task = await self.session.get(GalgameVideoExportTask, export_id)
        if task is None or task.project_id != project_id or task.output_asset_id is None:
            raise AssetError("导出视频尚不可下载", code="not_found", status=404)
        asset = await self.session.get(VisualAsset, task.output_asset_id)
        if asset is None:
            raise AssetError("导出视频已被删除", code="not_found", status=404)
        path = self.storage.path_for(asset)
        if not path.is_file():
            raise AssetError("导出视频文件不存在", code="not_found", status=404)
        return asset, path


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", value).strip(" .-")
    return (cleaned or "galgame-export")[:180]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _probe_video(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


class GalgameVideoExportRunner(PollingGenerationRunner):
    runner_name = "galgame-video-export-runner"
    poll_interval_seconds = 1.0

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] = SessionLocal,
        settings: Settings | None = None,
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)

    async def recover(self) -> None:
        async with self.session_factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(GalgameVideoExportTask).where(
                            GalgameVideoExportTask.status == "running"
                        )
                    )
                ).scalars()
            )
            for row in rows:
                row.status = "queued"
                row.cancel_requested = False
                row.error = None
                row.result_detail = {**(row.result_detail or {}), "phase": "queued"}
                row.revision += 1
                row.updated_at = utc_now()
            await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            task_id = await session.scalar(
                select(GalgameVideoExportTask.id)
                .where(GalgameVideoExportTask.status == "queued")
                .order_by(GalgameVideoExportTask.created_at)
                .limit(1)
            )
        if task_id:
            await self._process(task_id)

    async def _set(
        self,
        task_id: str,
        *,
        status: str | None = None,
        phase: str | None = None,
        progress: int | None = None,
        rendered_ms: int | None = None,
        error: str | None = None,
        output_asset_id: str | None = None,
        output_filename: str | None = None,
        finished: bool = False,
    ) -> None:
        async with self.session_factory() as session:
            task = await session.get(GalgameVideoExportTask, task_id)
            if task is None:
                return
            bind_workspace(session, task.workspace_id)
            detail = dict(task.result_detail or {})
            if phase is not None:
                detail["phase"] = phase
            if rendered_ms is not None:
                detail["renderedMs"] = max(0, rendered_ms)
            if output_filename is not None:
                detail["outputFilename"] = output_filename
            task.result_detail = detail
            if status is not None:
                task.status = status
            if progress is not None:
                task.progress = max(0, min(100, progress))
            if output_asset_id is not None:
                task.output_asset_id = output_asset_id
            task.error = error
            task.revision += 1
            task.updated_at = utc_now()
            if finished:
                task.finished_at = utc_now()
            await session.commit()

    async def _cancel_requested(self, task_id: str) -> bool:
        async with self.session_factory() as session:
            task = await session.get(GalgameVideoExportTask, task_id)
            return task is None or task.cancel_requested

    async def _process(self, task_id: str) -> None:
        try:
            async with self.session_factory() as session:
                task = await session.get(GalgameVideoExportTask, task_id)
                if task is None or task.status != "queued":
                    return
                bind_workspace(session, task.workspace_id)
                task.status = "running"
                task.started_at = task.started_at or utc_now()
                task.result_detail = {**(task.result_detail or {}), "phase": "preparing"}
                task.progress = 1
                task.revision += 1
                await session.commit()
                snapshot = await session.get(GalgameStorySnapshot, task.snapshot_id)
                project = await session.get(GalgameWorkshopProject, task.project_id)
                if snapshot is None or project is None:
                    raise RuntimeError("导出快照或项目已不存在")
                document = dict(snapshot.document)
                workspace_id = task.workspace_id
                project_id = task.project_id
                payload = dict(task.request_payload)
                total_ms = int((task.result_detail or {}).get("totalMs", 0))
                ending_label = str((task.result_detail or {}).get("endingLabel", "故事结束"))
                file_ids = [
                    item.get("fileId") for item in document.get("assets", []) if item.get("fileId")
                ]
                assets = (
                    list(
                        (
                            await session.execute(
                                select(VisualAsset).where(VisualAsset.id.in_(file_ids))
                            )
                        ).scalars()
                    )
                    if file_ids
                    else []
                )
                asset_paths = {item.id: str(self.storage.path_for(item)) for item in assets}

            render_script = (
                Path(__file__).resolve().parents[3] / "web" / "scripts" / "render-galgame-video.mjs"
            )
            with TemporaryDirectory(prefix=f"galgame-video-{task_id}-") as temp_dir:
                root = Path(temp_dir)
                manifest_path = root / "manifest.json"
                output_path = root / "output.mp4"
                manifest_path.write_text(
                    json.dumps(
                        {
                            "taskId": task_id,
                            "rendererUrl": self.settings.fpl_galgame_renderer_url,
                            "document": document,
                            "assetPaths": asset_paths,
                            "locale": payload.get("locale", "zh"),
                            "preset": payload.get("preset", "1080p30"),
                            "branchSelections": payload.get("branchSelections", []),
                            "choiceDurationMs": CHOICE_DURATION_MS,
                            "choiceHighlightMs": CHOICE_HIGHLIGHT_MS,
                            "totalMs": total_ms,
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
                await self._set(task_id, phase="rendering", progress=2)
                process = await asyncio.create_subprocess_exec(
                    shutil.which("node") or "node",
                    str(render_script),
                    str(manifest_path),
                    str(output_path),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,
                )
                stderr_chunks: list[bytes] = []

                async def read_stderr() -> None:
                    assert process.stderr is not None
                    while chunk := await process.stderr.read(8192):
                        stderr_chunks.append(chunk)
                        if sum(map(len, stderr_chunks)) > 64_000:
                            stderr_chunks.pop(0)

                stderr_task = asyncio.create_task(read_stderr())
                assert process.stdout is not None
                try:
                    while True:
                        try:
                            line = await asyncio.wait_for(process.stdout.readline(), timeout=1.0)
                        except TimeoutError:
                            line = b""
                        if await self._cancel_requested(task_id):
                            if process.returncode is None:
                                os.killpg(process.pid, signal.SIGTERM)
                            await process.wait()
                            await stderr_task
                            await self._set(
                                task_id,
                                status="cancelled",
                                phase="cancelled",
                                error=None,
                                finished=True,
                            )
                            return
                        if line:
                            try:
                                event = json.loads(line)
                            except (json.JSONDecodeError, UnicodeDecodeError):
                                event = {}
                            rendered_ms = int(event.get("renderedMs", 0))
                            phase = str(event.get("phase", "rendering"))
                            progress = (
                                min(88, 2 + round(rendered_ms / total_ms * 86))
                                if total_ms > 0
                                else 2
                            )
                            await self._set(
                                task_id,
                                phase=(
                                    phase if phase in {"rendering", "encoding"} else "rendering"
                                ),
                                progress=progress,
                                rendered_ms=rendered_ms,
                            )
                        if process.returncode is not None:
                            break
                        if not line:
                            try:
                                await asyncio.wait_for(process.wait(), timeout=0.01)
                            except TimeoutError:
                                continue
                finally:
                    if process.returncode is None:
                        try:
                            os.killpg(process.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                        await asyncio.shield(process.wait())
                await stderr_task
                if process.returncode != 0:
                    message = b"".join(stderr_chunks).decode(errors="replace").strip()
                    raise RuntimeError(message[-4000:] or "视频渲染器执行失败")
                if not output_path.is_file():
                    raise RuntimeError("视频渲染器没有生成输出文件")
                await self._set(task_id, phase="verifying", progress=90)
                probe = await asyncio.to_thread(_probe_video, output_path)
                streams = probe.get("streams", [])
                video = next((item for item in streams if item.get("codec_type") == "video"), None)
                audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
                width, height, expected_fps = PRESETS[payload.get("preset", "1080p30")]
                if video is None or video.get("codec_name") != "h264":
                    raise RuntimeError("导出结果缺少 H.264 视频轨")
                if int(video.get("width", 0)) != width or int(video.get("height", 0)) != height:
                    raise RuntimeError("导出结果分辨率不符合预设")
                if video.get("pix_fmt") != "yuv420p":
                    raise RuntimeError("导出结果不是兼容性要求的 yuv420p 视频")
                numerator, _, denominator = str(video.get("avg_frame_rate", "0/1")).partition("/")
                actual_fps = float(numerator or 0) / max(1.0, float(denominator or 1))
                if abs(actual_fps - expected_fps) > 0.05:
                    raise RuntimeError(f"导出帧率不稳定，请改用 {width}×{height} / 30fps")
                if audio is None or audio.get("codec_name") != "aac":
                    raise RuntimeError("导出结果缺少 AAC 音频轨")
                actual_duration_ms = round(float(probe["format"]["duration"]) * 1000)
                frame_ms = 1000 / expected_fps
                if abs(actual_duration_ms - total_ms) > frame_ms + 2:
                    raise RuntimeError("导出结果时长与所选路线不一致")
                timestamp = utc_now().strftime("%Y%m%d-%H%M%S")
                project_label = _safe_filename(project.title)
                ending_filename = _safe_filename(ending_label)
                filename = f"{project_label}-{ending_filename}-{timestamp}.mp4"
                await self._set(task_id, phase="registering", progress=95)
                async with self.session_factory() as session:
                    bind_workspace(session, workspace_id)
                    library = AssetLibrary(session, self.settings)
                    asset, staged_path = await library.stage_local_copy(
                        output_path,
                        filename=filename,
                        content_type="video/mp4",
                        galgame_project_id=project_id,
                        allowed_extensions={".mp4"},
                        max_bytes=self.settings.fpl_galgame_export_max_bytes,
                    )
                    try:
                        metadata = GalgameAssetMetadata(
                            asset_id=asset.id,
                            project_id=project_id,
                            category="video",
                            virtual_path=f"exports/{filename}",
                            packaging_policy=EXPORT_PACKAGING_POLICY,
                            checksum_sha256=await asyncio.to_thread(_sha256_file, output_path),
                            width=width,
                            height=height,
                            duration_ms=actual_duration_ms,
                        )
                        session.add(metadata)
                        session.add(
                            GalgameProjectAssetReference(project_id=project_id, asset_id=asset.id)
                        )
                        await session.commit()
                    except Exception:
                        await session.rollback()
                        staged_path.unlink(missing_ok=True)
                        raise
                await self._set(
                    task_id,
                    status="completed",
                    phase="completed",
                    progress=100,
                    rendered_ms=total_ms,
                    output_asset_id=asset.id,
                    output_filename=filename,
                    finished=True,
                )
        except Exception as exc:
            await self._set(
                task_id,
                status="failed",
                phase="failed",
                error=str(exc)[:4000],
                finished=True,
            )

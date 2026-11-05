"""Calculate the published Galgame video plan from verified file and runtime facts."""

import hashlib
import json

from app.apps.galgame_workshop.schemas import (
    GalgameVideoExportChoiceOut,
    GalgameVideoExportDecisionOut,
    GalgameVideoExportIssue,
    GalgameVideoExportPreviewOut,
    GalgameVideoExportRouteOut,
)
from app.capabilities.media_rendering.galgame.timing import COMPILER_VERSION, PRESETS

from .video_export_planning import (
    _plan_clip,
    _plan_fragments,
    _plan_route,
)


def preview_export(story, body, *, assets_by_file, available, durations_by_file, capacity):
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
    asset_duration = {
        asset.id: durations_by_file[asset.file_id]
        for asset in story.document.assets
        if asset.file_id in durations_by_file
    }
    for index, story_asset in enumerate(document.get("assets", [])):
        file_id = story_asset.get("fileId")
        if file_id not in available:
            blockers.append(
                GalgameVideoExportIssue(
                    code="missing_asset",
                    message=f"素材“{story_asset.get('label') or story_asset.get('id')}”不可用",
                    path=f"/assets/{index}",
                )
            )
    for program in capacity.missing_programs:
        blockers.append(
            GalgameVideoExportIssue(
                code="renderer_dependency_missing",
                message=f"视频导出缺少运行程序：{program}",
                path="/renderer",
            )
        )
    if capacity.font_issue:
        blockers.append(
            GalgameVideoExportIssue(
                code="renderer_font_missing",
                message=capacity.font_issue,
                path="/renderer/fonts",
            )
        )
    selections = {item.branch_block_id: item.choice_id for item in body.branch_selections}
    if body.scope == "fragments":
        plan = _plan_fragments(document, body.fragment_ids, asset_duration)
    elif body.scope == "clip" and body.clip_range is not None:
        plan = _plan_clip(
            document,
            body.clip_range.fragment_id,
            body.clip_range.start_ms,
            body.clip_range.end_ms,
        )
    else:
        plan = _plan_route(document, selections, asset_duration)
        if plan.fragment_ids and not plan.fragment_durations_ms:
            fragment_plan = _plan_fragments(document, plan.fragment_ids, asset_duration)
            plan.fragment_durations_ms = fragment_plan.fragment_durations_ms
            if plan.fragment_durations_ms:
                remainder = plan.duration_ms - sum(plan.fragment_durations_ms)
                plan.fragment_durations_ms[-1] += max(0, remainder)
    blockers.extend(plan.blockers)
    warnings.extend(plan.warnings)
    bitrate_mbps = 6 if body.preset == "720p30" else (18 if body.preset == "1080p60" else 10)
    estimated_work_bytes = max(
        2 * 1024 * 1024 * 1024,
        round(plan.duration_ms / 1000 * bitrate_mbps * 1_000_000 / 8 * 3),
    )
    if capacity.free_bytes < estimated_work_bytes:
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
        fragmentDurationsMs=plan.fragment_durations_ms,
        branchBlockIds=plan.branch_block_ids,
        endingLabel=plan.ending_label,
        estimatedDurationMs=plan.duration_ms,
        exactDuration=plan.exact_duration,
    )
    fingerprint_payload = {
        "compilerVersion": COMPILER_VERSION,
        "storyRevision": story.revision,
        "locale": body.locale,
        "preset": body.preset,
        "scope": body.scope,
        "fragmentIds": body.fragment_ids,
        "clipRange": (
            body.clip_range.model_dump(mode="json", by_alias=True)
            if body.clip_range is not None
            else None
        ),
        "branchSelections": [
            item.model_dump(mode="json", by_alias=True) for item in body.branch_selections
        ],
        "captureFrame": body.capture_frame.model_dump(mode="json", by_alias=True),
        "route": route.model_dump(mode="json", by_alias=True),
        "decision": decision.model_dump(mode="json", by_alias=True) if decision else None,
        "assets": [
            {
                "id": asset.id,
                "revision": asset.revision,
                "bytes": asset.byte_size,
                "updatedAt": asset.updated_at.isoformat(),
            }
            for asset in sorted(assets_by_file.values(), key=lambda item: item.id)
        ],
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

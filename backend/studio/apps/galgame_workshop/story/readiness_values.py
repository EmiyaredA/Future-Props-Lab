"""Combine route, media duration and package validation results."""

from studio.apps.galgame_workshop.schemas import GalgameStoryReportIssue


def invalid_asset_reference(report, message):
    issue = GalgameStoryReportIssue(code="invalid_asset_reference", message=message, path="/assets")
    return report.model_copy(update={"ready": False, "errors": [*report.errors, issue]})


def complete_readiness(report, document, *, missing_ids, durations, manifest):
    errors = [
        *report.errors,
        *[
            GalgameStoryReportIssue(
                code="missing_asset_file",
                message="故事素材文件不存在",
                path=f"/assets/{index}",
            )
            for index, asset in enumerate(document.assets)
            if asset.file_id in missing_ids
        ],
    ]
    assets_by_id = {asset.id: asset for asset in document.assets}
    for chapter_index, chapter in enumerate(document.chapters):
        for fragment_index, fragment in enumerate(chapter.fragments):
            master = fragment.timeline.master_audio if fragment.timeline else None
            if master is None:
                continue
            story_asset = assets_by_id[master.asset_id]
            duration = durations.get(story_asset.file_id)
            path = (
                f"/chapters/{chapter_index}/fragments/{fragment_index}/timeline/masterAudio/assetId"
            )
            if duration is None:
                errors.append(
                    GalgameStoryReportIssue(
                        code="timeline_master_audio_duration_unknown",
                        message="时间轴主音轨缺少可校验的媒体时长",
                        path=path,
                    )
                )
                continue
            if abs(duration - fragment.timeline.duration_ms) > 1:
                errors.append(
                    GalgameStoryReportIssue(
                        code="timeline_master_audio_duration_mismatch",
                        message=(
                            "时间轴主音轨时长与剧情时间轴不一致："
                            f"{duration}ms / {fragment.timeline.duration_ms}ms"
                        ),
                        path=path,
                    )
                )
    existing_codes = {(issue.code, issue.message) for issue in errors}
    for issue in manifest.issues:
        identity = (issue.code, issue.message)
        if identity in existing_codes:
            continue
        errors.append(
            GalgameStoryReportIssue(
                code=issue.code,
                message=issue.message,
                path="/assets",
            )
        )
        existing_codes.add(identity)
    if not errors:
        return report
    return report.model_copy(update={"ready": False, "errors": errors})

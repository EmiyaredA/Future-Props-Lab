"""Build JSON and native package exports from a revision-pinned document."""

import json

from studio.apps.presentation_workshop.exchange.archives import MAX_BYTES, write_package
from studio.apps.presentation_workshop.exchange.contracts import ConversionIssue, ExportPreview
from studio.apps.presentation_workshop.exports import render_in_thread, snapshot_at
from studio.apps.presentation_workshop.project_errors import PresentationError
from studio.apps.presentation_workshop.templates.resolver import resolve_document


async def export_preview(projects, project_id, revision):
    snapshot = await snapshot_at(projects, project_id, revision)

    _, template_issues = resolve_document(snapshot.document)
    issues = [
        ConversionIssue(slide_id=i["slide_id"], code=i["code"], message=i["message"])
        for i in template_issues
    ]
    for slide in snapshot.document.slides:
        if slide.animations or slide.transition:
            issues.append(
                ConversionIssue(
                    slide_id=slide.id,
                    code="static_animation",
                    message="工坊动画与翻页效果保留在文稿包中，PPTX 导出静态可编辑对象",
                )
            )
        if slide.annotations:
            issues.append(
                ConversionIssue(
                    slide_id=slide.id,
                    code="annotations_not_exported",
                    message="页面批注与回复保留在文稿包中，不写入 PPTX",
                )
            )
        for element in slide.elements:
            if element.hidden:
                continue
            if element.kind in {"table", "chart"} and element.opacity != 1:
                issues.append(
                    ConversionIssue(
                        slide_id=slide.id,
                        element_id=element.id,
                        code="object_opacity",
                        message="表格与图表的整体透明度不写入 PPTX",
                    )
                )
            if element.image_effects:
                issues.append(
                    ConversionIssue(
                        slide_id=slide.id,
                        element_id=element.id,
                        code="image_effects_baked",
                        message="图片滤镜写入 PPTX 的图片像素，原图与可调整滤镜保留在文稿包中",
                    )
                )
            if element.chart and element.chart.type == "area" and element.chart.smooth:
                issues.append(
                    ConversionIssue(
                        slide_id=slide.id,
                        element_id=element.id,
                        code="area_smoothing",
                        message="PPTX 面积图使用直线边界，保留原生数据编辑",
                    )
                )
    return ExportPreview(revision=revision, issues=issues)


async def export_document(projects, project_id, revision, format):
    snapshot = await snapshot_at(projects, project_id, revision)
    if format == "json":
        return json.dumps(
            {"title": snapshot.title, "document": snapshot.document.model_dump()},
            ensure_ascii=False,
        ).encode()
    rows = await projects.assets(snapshot.document)
    if sum(row.byte_size for row in rows) > MAX_BYTES:
        raise PresentationError("文稿素材总量不能超过 100 MiB", 413, "export_too_large")
    async with projects.asset_access.export_sources(rows) as sources:
        return await render_in_thread(write_package, snapshot, sources)

"""Explicit legacy conversion and revision-pinned template change previews."""

import hashlib
import json

from sqlalchemy import update

from app.apps.presentation_workshop.projects import PresentationError
from app.apps.presentation_workshop.schemas.document import (
    PresentationDocument,
    PresentationProjectPut,
)
from app.apps.presentation_workshop.templates.contracts import TemplateChangePreview
from app.apps.presentation_workshop.templates.models import PresentationTemplate
from app.apps.presentation_workshop.templates.resolver import materialize, resolve_document
from app.apps.presentation_workshop.templates.schema import TemplateBinding
from app.runtime.revisions import RevisionConflictError


async def preview_change(library, project_id, body):
    project = await library.projects.get(project_id)
    if body.expected_revision != project.revision:
        raise RevisionConflictError(
            body.expected_revision, project.revision, project.model_dump(mode="json")
        )
    document = project.document.model_copy(deep=True)
    changes = []
    target = None
    if body.action == "unbind":
        if not document.template:
            raise PresentationError("当前文稿尚未绑定模板")
        document = materialize(document)
        changes = ["解除绑定；当前模板内容转为普通可编辑对象"]
    else:
        if not body.template_id or body.template_revision is None:
            raise PresentationError("请选择模板及对应版本")
        try:
            target = await library.get("templates", body.template_id)
        except PresentationError as exc:
            if exc.status == 404 and hasattr(body, "preview_token"):
                raise PresentationError(
                    "目标模板已删除，请重新预览", 409, "template_preview_stale"
                ) from None
            raise
        if target.revision != body.template_revision:
            raise RevisionConflictError(
                body.template_revision, target.revision, target.model_dump(mode="json")
            )
        if body.action == "update" and (
            not document.template or document.template.template_id != target.id
        ):
            raise PresentationError(
                "模板绑定已变化，请重新选择模板", 409, "template_binding_changed"
            )
        if (target.definition.width, target.definition.height) != (document.width, document.height):
            raise PresentationError("模板尺寸不同；更换模板不会调整正文，请使用相同尺寸的模板")
        previous = document.template.snapshot.model_dump() if document.template else {}
        next_definition = target.definition.model_dump()
        labels = {
            "layouts": "五种页型布局、标题和背景",
            "fixed": "固定元素",
            "font": "全局字体",
            "foreground": "文字颜色",
            "accent": "强调色",
            "number_start": "页码起始值",
            "number_total": "总页数显示",
            "number_hidden_types": "页码适用页型",
        }
        changes = [
            labels.get(key, key)
            for key, value in next_definition.items()
            if previous.get(key) != value
        ]
        if not document.template and len(body.mappings) != len(document.slides):
            raise PresentationError("首次绑定必须逐页确认标题对象与章节；不能自动猜测正文")
        mappings = {mapping.slide_id: mapping for mapping in body.mappings}
        if len(mappings) != len(body.mappings) or set(mappings) - {s.id for s in document.slides}:
            raise PresentationError("页面映射重复或引用了不存在的页面")
        if body.chapters is not None:
            document.chapters = body.chapters
        for slide in document.slides:
            mapping = mappings.get(slide.id)
            if not mapping:
                continue
            remove = set(mapping.title_element_ids)
            if remove - {e.id for e in slide.elements}:
                raise PresentationError("标题对象不存在，请重新确认")
            if any(e.id in remove and e.kind != "text" for e in slide.elements):
                raise PresentationError("只能将明确选择的文字对象转换为模板标题")
            # Existing scene references must not dangle after explicit conversion.
            if any(any(identity in remove for identity in g.element_ids) for g in slide.groups):
                raise PresentationError("请先取消标题对象的分组后转换")
            if any(c.source_id in remove or c.target_id in remove for c in slide.connections):
                raise PresentationError("标题对象仍有关联连线，请先解除关联")
            if any(a.element_id in remove for a in slide.animations) or any(
                a.element_id in remove for a in slide.annotations
            ):
                raise PresentationError("标题对象仍有动画或批注，请先解除关联")
            slide.elements = [e for e in slide.elements if e.id not in remove]
            slide.title, slide.chapter_id, slide.page_type = (
                mapping.title,
                mapping.chapter_id,
                mapping.page_type,
            )
        document.version = 4
        document.template = TemplateBinding(
            template_id=target.id,
            template_revision=target.revision,
            name=target.title,
            snapshot=target.definition,
        )
        document = PresentationDocument.model_validate(document.model_dump())
    after, issues = resolve_document(document)
    before, _ = resolve_document(project.document)
    previous_pages = {s.id: s.model_dump() for s in before.slides}
    affected = [s.id for s in after.slides if s.model_dump() != previous_pages.get(s.id)]
    canonical = {
        "project": project.model_dump(mode="json"),
        "target": target.model_dump(mode="json") if target else None,
        "request": body.model_dump(exclude={"preview_token"}),
        "result": document.model_dump(mode="json"),
    }
    token = hashlib.sha256(
        json.dumps(canonical, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    return project, TemplateChangePreview(
        document_revision=project.revision,
        template_revision=target.revision if target else None,
        preview_token=token,
        changes=changes,
        affected_slides=affected,
        issues=issues,
        document=document,
    )


async def apply_change(library, project_id, body):
    project, preview = await preview_change(library, project_id, body)
    if preview.preview_token != body.preview_token:
        raise PresentationError("预览已失效，请重新预览模板变更", 409, "template_preview_stale")
    if body.action != "unbind":
        # Acquire the same write transaction as the document CAS, pinning the target.
        result = await library.session.execute(
            update(PresentationTemplate)
            .where(
                PresentationTemplate.id == body.template_id,
                PresentationTemplate.workspace_id == library.workspace_id,
                PresentationTemplate.revision == body.template_revision,
            )
            .values(revision=PresentationTemplate.revision)
        )
        if result.rowcount != 1:
            raise PresentationError("模板已更新，请重新预览", 409, "template_preview_stale")
    return await library.projects.put(
        project_id,
        PresentationProjectPut(
            title=project.title, document=preview.document, expected_revision=project.revision
        ),
    )

"""Explicit v1 slot conversion, preserving known configuration without body inference."""

from studio.apps.presentation_workshop.templates.resolver import element
from studio.apps.presentation_workshop.templates.scenes import TemplateScene, TemplateSemantic
from studio.apps.presentation_workshop.templates.schema import effective_template


def native_layout(layout, width, height):
    converted = layout.model_copy(deep=True)
    converted.scene = TemplateScene()
    for role in ("chapter", "title", "number", "toc"):
        slot = getattr(layout, role)
        e = element("slot-" + role, "text", slot, role, slot.style)
        e.hidden, e.locked = not slot.visible, False
        converted.scene.elements.append(e)
        converted.scene.semantics.append(TemplateSemantic(element_id=e.id, role=role))
    if layout.background_asset_id:
        from types import SimpleNamespace

        # A page background is explicit configuration, not inferred from body objects.
        converted.scene.elements.insert(
            0,
            element(
                "legacy-background",
                "image",
                SimpleNamespace(x=0, y=0, width=width, height=height),
                asset_id=layout.background_asset_id,
            ),
        )
    return converted


def preserve_legacy_overrides(document, target):
    if not document.template or document.template.snapshot.version != 1 or target.version != 2:
        return
    effective = effective_template(document.template, document.template_overrides)
    for kind in list(document.template_overrides.layouts):
        layout = native_layout(effective.layouts[kind], document.width, document.height)
        layout.defaults = target.layouts[kind].defaults.model_copy(deep=True)
        document.template_overrides.layouts[kind] = layout
    if document.template_overrides.fixed is not None:
        scene = target.global_scene.model_copy(deep=True)
        for item in document.template_overrides.fixed:
            e = element(
                item.id,
                item.kind,
                item,
                item.text,
                item.style,
                item.asset_id,
                item.fill,
                item.opacity,
            )
            e.locked = False
            scene.elements = [old for old in scene.elements if old.id != e.id]
            scene.elements.append(e)
            scene.page_types[e.id] = item.page_types
        document.template_overrides.global_scene = scene

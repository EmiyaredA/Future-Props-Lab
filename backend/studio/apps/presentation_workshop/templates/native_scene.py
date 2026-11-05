"""Deterministic instantiation of portable native template objects."""

from studio.apps.presentation_workshop.schemas.document import PresentationSlide
from studio.apps.presentation_workshop.templates.scenes import PresentationLayoutSource


def scene_ids(scene, prefix):
    roles = {s.element_id: s.role for s in scene.semantics}
    return {
        obj.id: prefix + roles.get(obj.id, "object") + "-" + str(index)
        for index, obj in enumerate(
            [*scene.elements, *scene.groups, *scene.connections, *scene.infographics]
        )
    }


def instantiate(
    scene, prefix, *, texts=None, hidden=(), definition=None, snapshot=None, page_type=None
):
    """Remap every scene reference. Semantic text never comes from preview copy."""
    ids = scene_ids(scene, prefix)
    roles = {s.element_id: s.role for s in scene.semantics}
    elements = []
    for source in scene.elements:
        e = source.model_copy(deep=True)
        role = roles.get(e.id)
        e.id = ids[e.id]
        e.locked = texts is not None
        e.hidden = e.hidden or source.id in hidden or role in hidden
        if (
            page_type
            and source.id in scene.page_types
            and page_type not in scene.page_types[source.id]
        ):
            e.hidden = True
        if role and texts is not None:
            text = texts.get(role, "")
            e.hidden = e.hidden or not text
            prototype = e.paragraphs[0]
            e.paragraphs = [prototype.model_copy(deep=True)]
            e.paragraphs[0].runs = [prototype.runs[0].model_copy(update={"text": text})]
        if definition and snapshot:
            for p in e.paragraphs:
                for r in p.runs:
                    if r.font == snapshot.font:
                        r.font = definition.font
                    if r.color == snapshot.foreground:
                        r.color = definition.foreground
                    elif r.color == snapshot.accent:
                        r.color = definition.accent
        elements.append(e)
    groups = [
        g.model_copy(
            update={
                "id": ids[g.id],
                "parent_id": ids.get(g.parent_id),
                "element_ids": [ids[i] for i in g.element_ids],
            }
        )
        for g in scene.groups
    ]
    connections = [
        c.model_copy(
            update={
                "id": ids[c.id],
                "source_id": ids.get(c.source_id),
                "target_id": ids.get(c.target_id),
            }
        )
        for c in scene.connections
    ]
    infographics = [
        i.model_copy(update={"id": ids[i.id], "group_id": ids[i.group_id]})
        for i in scene.infographics
    ]
    return dict(
        elements=elements, groups=groups, connections=connections, infographics=infographics
    )


def default_page(definition, page_type, identity, template_id=None, revision=0):
    scene = definition.layouts[page_type].defaults
    fragment = instantiate(scene, identity + "-")
    ids = scene_ids(scene, identity + "-")
    return PresentationSlide.model_validate(
        {
            "id": identity,
            "background": definition.layouts[page_type].background,
            "notes": "",
            "page_type": page_type,
            **fragment,
            "layout_source": PresentationLayoutSource(
                template_id=template_id,
                template_revision=revision,
                page_type=page_type,
                objects=[{"element_id": ids[e.id], "default_id": e.id} for e in scene.elements],
            ).model_dump(),
        }
    )


def expand_page(document, source, index, definition, entries, chapters):
    layout = definition.layouts[source.page_type]
    number = str(definition.number_start + index)
    if definition.number_total:
        number += " / " + str(len(document.slides))
    if source.page_type in definition.number_hidden_types:
        number = ""
    texts = {
        "chapter": chapters.get(source.chapter_id, ""),
        "title": source.title,
        "number": number,
        "toc": "\n".join(
            e["title"] + "    " + str(e["page"])
            for e in entries[source.toc_offset : source.toc_offset + layout.toc_capacity]
        )
        if source.page_type == "toc"
        else "",
    }
    fragments = [
        instantiate(
            scene,
            f"master-{index}-{scope}-",
            texts=texts,
            hidden=source.template_hidden,
            definition=definition,
            snapshot=document.template.snapshot,
            page_type=source.page_type,
        )
        for scope, scene in (("global", definition.global_scene), ("page", layout.scene))
    ]
    slide = source.model_copy(deep=True)
    offset = sum(len(f["elements"]) for f in fragments)
    slide.connections = [
        c.model_copy(update={"layer": c.layer + offset}) for c in slide.connections
    ]
    for key in ("elements", "groups", "connections", "infographics"):
        setattr(slide, key, [v for f in fragments for v in f[key]] + getattr(slide, key))
    # Global connectors are below page-type objects, body connectors retain their order.
    global_count = len(fragments[0]["elements"])
    for c in fragments[1]["connections"]:
        c.layer += global_count
    slide.background, slide.background_style = layout.background, None
    return slide

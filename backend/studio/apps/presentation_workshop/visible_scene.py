"""Resolve hidden nodes and their edges once at the export boundary."""

from studio.apps.presentation_workshop.schemas.document import PresentationSlide


def visible_scene(page: PresentationSlide) -> PresentationSlide:
    visible = {e.id for e in page.elements if not e.hidden}
    if len(visible) == len(page.elements):
        return page
    return page.model_copy(
        update={
            "elements": [e for e in page.elements if e.id in visible],
            "connections": [
                c.model_copy(
                    update={"layer": sum(e.id in visible for e in page.elements[: c.layer])}
                )
                for c in page.connections
                if all(i is None or i in visible for i in (c.source_id, c.target_id))
            ],
            "groups": [
                g.model_copy(update={"element_ids": [i for i in g.element_ids if i in visible]})
                for g in page.groups
            ],
        }
    )

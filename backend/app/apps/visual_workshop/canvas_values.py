"""Visual canvas response values, independent of the asset store."""

from app.apps.visual_workshop.models import VisualCanvasDocument
from app.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
    default_material_categories,
)
from app.runtime.time import iso_utc


def canvas_out(row: VisualCanvasDocument) -> VisualCanvasDocumentOut:
    return VisualCanvasDocumentOut(
        project_id=row.project_id,
        nodes=row.nodes or [],
        edges=row.edges or [],
        revision=row.revision,
        updated_at=iso_utc(row.updated_at),
        categories=row.categories or default_material_categories(),
    )

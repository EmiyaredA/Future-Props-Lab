"""Project response values shared by the installed and compatibility sites."""

from app.apps.visual_workshop.models import VisualWorkshopProject
from app.apps.visual_workshop.schemas.workshop import VisualWorkshopProjectOut
from app.runtime.time import iso_utc


def project_out(row: VisualWorkshopProject) -> VisualWorkshopProjectOut:
    return VisualWorkshopProjectOut(
        id=row.id,
        title=row.title,
        is_official=row.is_official,
        kind=row.kind,
        status=row.status,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )

"""Project response values shared by the installed and compatibility sites."""

from studio.apps.galgame_workshop.schemas.base import GalgameWorkshopProjectOut
from studio.apps.galgame_workshop.storage.models import GalgameWorkshopProject
from studio.runtime.time import iso_utc


def project_out(row: GalgameWorkshopProject) -> GalgameWorkshopProjectOut:
    return GalgameWorkshopProjectOut(
        id=row.id,
        title=row.title,
        is_official=row.is_official,
        status=row.status,  # type: ignore[arg-type]
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )

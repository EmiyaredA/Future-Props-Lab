from sqlalchemy import select

from studio.apps.visual_workshop.storage.models import VisualWorkshopProject


class AcceptanceError(Exception):
    def __init__(self, message, code="invalid_acceptance", status=422):
        super().__init__(message)
        self.code, self.status = code, status


async def project(session, owner_user_id, project_id):
    row = await session.scalar(
        select(VisualWorkshopProject).where(
            VisualWorkshopProject.id == project_id,
            VisualWorkshopProject.owner_user_id == owner_user_id,
        )
    )
    if row is None:
        raise AcceptanceError("项目不存在", "not_found", 404)
    return row

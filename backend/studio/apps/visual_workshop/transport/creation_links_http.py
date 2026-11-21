"""Authenticated project creative links, shared by both assemblies."""

from fastapi import APIRouter

from studio.apps.visual_workshop.creation_links.records import CreationLinkRecords
from studio.apps.visual_workshop.creation_links.schemas import CreationLinksOut, CreationLinksUpdate
from studio.apps.visual_workshop.transport.project_errors import resolve
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter(prefix="/visual-workshop", tags=["visual-workshop"])


@router.get("/projects/{project_id}/creation-links", response_model=CreationLinksOut)
async def get_creation_links(session: SessionDep, owner: OwnerDep, project_id: str):
    return await resolve(CreationLinkRecords(session, owner).get(project_id))


@router.put("/projects/{project_id}/creation-links", response_model=CreationLinksOut)
async def save_creation_links(
    session: SessionDep, owner: OwnerDep, project_id: str, body: CreationLinksUpdate
):
    return await resolve(CreationLinkRecords(session, owner).save(project_id, body))

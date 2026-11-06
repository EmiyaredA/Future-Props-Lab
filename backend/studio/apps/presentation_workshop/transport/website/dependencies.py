"""Build request-scoped presentation adapters using the active assembly."""

from typing import Annotated

from fastapi import Depends, Request

from studio.apps.presentation_workshop.projects import Presentations
from studio.assembly.http_dependencies import OwnerDep, SessionDep


async def presentation_projects(request: Request, session: SessionDep, owner: OwnerDep):
    return request.app.state.presentation_projects(request, session, owner)


PresentationDep = Annotated[Presentations, Depends(presentation_projects)]

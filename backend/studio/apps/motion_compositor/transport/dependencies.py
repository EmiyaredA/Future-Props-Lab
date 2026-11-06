"""Resolve the account-scoped Motion project adapter at the HTTP boundary."""

from typing import Annotated

from fastapi import Depends, Request

from studio.apps.motion_compositor.projects import MotionProjects
from studio.assembly.http_dependencies import OwnerDep, SessionDep


async def motion_projects(request: Request, session: SessionDep, owner: OwnerDep):
    return request.app.state.motion_projects(request, session, owner)


MotionDep = Annotated[MotionProjects, Depends(motion_projects)]

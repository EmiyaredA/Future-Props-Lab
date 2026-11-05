"""Forward the certification command to the project owner without loading its ORM."""

from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request

from app.console.schemas.project_certification import CertificationIn, CertificationOut
from app.deps import StudioAuth
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.certification_client import CertificationRejected
from fpl_runtime.project_certification import CertificationCommand, Kind

router = APIRouter(tags=["platform-governance"])


@router.patch(
    "/v1/account/project-certification/{kind}/{project_id}", response_model=CertificationOut
)
async def certification(
    kind: Kind,
    project_id: str,
    body: CertificationIn,
    request: Request,
    principal: StudioAuth,
):
    if principal.auth_kind != "session":
        raise HTTPException(403, {"code": "browser_session_required"})
    if not principal.allows("projects.certify") or not principal.allows("content.write"):
        raise HTTPException(403, {"code": "project_certification_required"})
    try:
        command = CertificationCommand(
            kind=kind,
            project_id=project_id,
            request_id=uuid4(),
            expected_revision=body.expected_revision,
            is_official=body.is_official,
        )
    except ValueError:
        raise HTTPException(404, {"code": "project_not_found"}) from None
    try:
        return await request.app.state.certifications.certify(
            request.state.service_assertion, command, principal.user_id
        )
    except CertificationRejected as exc:
        raise HTTPException(exc.status, exc.detail) from None
    except CapabilityUnavailable:
        raise HTTPException(503, {"code": "project_certification_unconfirmed"}) from None

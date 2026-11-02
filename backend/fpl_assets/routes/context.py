"""Bind the verified account request to explicit file and project-validation cases."""

from fastapi import HTTPException

from app.console.file_library import LibraryFolderArchive
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable

from ..files import Files


def cases(request, session, owner_user_id):
    async def project_exists(identifier):
        try:
            return await request.app.state.capabilities.project_exists(
                assertion=request.state.service_assertion,
                source_method=request.method,
                source_path=request.url.path,
                project_id=identifier,
            )
        except CapabilityDenied as exc:
            raise HTTPException(exc.status, {"code": "project_authorization_denied"}) from exc
        except CapabilityUnavailable as exc:
            raise HTTPException(503, {"code": "project_service_unavailable"}) from exc

    return Files(
        session,
        request.app.state.settings,
        owner_user_id,
        project_exists=project_exists,
    )


def archive(request, session, owner_user_id):
    return LibraryFolderArchive(session, request.app.state.settings, owner_user_id)

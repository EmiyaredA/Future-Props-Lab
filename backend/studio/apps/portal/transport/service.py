"""Developer documents preserve browser-only authorization and the public operation ID."""

from fastapi import APIRouter, HTTPException, Request

from studio.contracts.portal.documents import DeveloperDocumentsOut
from studio.runtime.http.dependencies import StudioAuth

router = APIRouter(tags=["platform-governance"])


@router.get(
    "/account/developer-documents",
    response_model=DeveloperDocumentsOut,
    operation_id="developer_docs_v1_account_developer_documents_get",
)
async def developer_docs(request: Request, principal: StudioAuth):
    if principal.auth_kind != "session":
        raise HTTPException(403, {"code": "browser_session_required"})
    return request.app.state.developer_documents.read(principal)

"""Developer documents preserve browser-only authorization and the public operation ID."""

from fastapi import APIRouter, HTTPException

from app.console.governance.developer_docs import developer_documents
from app.console.schemas.developer_documents import DeveloperDocumentsOut
from fpl_runtime.http_dependencies import StudioAuth

router = APIRouter(tags=["platform-governance"])


@router.get(
    "/account/developer-documents",
    response_model=DeveloperDocumentsOut,
    operation_id="developer_docs_v1_account_developer_documents_get",
)
async def developer_docs(principal: StudioAuth):
    if principal.auth_kind != "session":
        raise HTTPException(403, {"code": "browser_session_required"})
    return developer_documents(principal)

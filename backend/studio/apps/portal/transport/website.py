"""Website authorization adapter for the shared document use case."""

from fastapi import APIRouter, Request, Response

from studio.apps.identity.transport.website.auth import _browser_auth
from studio.assembly.http_dependencies import SessionDep
from studio.contracts.portal.documents import DeveloperDocumentsOut

router = APIRouter(tags=["platform-governance"])


@router.get("/account/developer-documents", response_model=DeveloperDocumentsOut)
async def developer_docs(request: Request, response: Response, session: SessionDep):
    principal = await _browser_auth(request, session)
    response.headers["Cache-Control"] = "no-store"
    return request.app.state.developer_documents.read(principal)

"""Community publication writes using the published-cover reference lifecycle."""

from fastapi import APIRouter, Request

from app.apps.thought_workshop.http_bindings import CommunitySessionDep as SessionDep
from app.apps.thought_workshop.publication.imports import SeedImportInput, import_source
from app.apps.thought_workshop.publication.schemas import PublicationConfig, PublishInput
from app.apps.thought_workshop.schemas.workshop import ThoughtImportOut
from app.deps import PublicStudioAuth

from .mutations_http import context, guarded
from .official_projections import OfficialProjections
from .publication_retention import publish_with_references

router = APIRouter(prefix="/thought-workshop/community", tags=["knowledge-community"])


@router.post("/official-import", response_model=ThoughtImportOut)
async def import_official(
    body: SeedImportInput, session: SessionDep, principal: PublicStudioAuth, request: Request
):
    projections = OfficialProjections(
        owner=principal.user_id, identity=request.app.state.identity, **context(request)
    )
    return await guarded(import_source(session, principal, body, projections=projections))


@router.put("/libraries/{library_id}/publication", response_model=PublicationConfig)
async def publish(
    library_id: str,
    body: PublishInput,
    session: SessionDep,
    principal: PublicStudioAuth,
    request: Request,
):
    return await guarded(
        publish_with_references(session, principal, body, library_id=library_id, **context(request))
    )


@router.put("/publications/{publication_id}/management", response_model=PublicationConfig)
async def manage(
    publication_id: str,
    body: PublishInput,
    session: SessionDep,
    principal: PublicStudioAuth,
    request: Request,
):
    return await guarded(
        publish_with_references(
            session, principal, body, publication_id=publication_id, **context(request)
        )
    )

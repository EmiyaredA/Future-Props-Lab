from fastapi import APIRouter, Query

from app.deps import OwnerDep, StudioAuth
from studio.apps.thought_workshop.http_bindings import SessionDep
from studio.apps.thought_workshop.knowledge_tools.http import call
from studio.apps.thought_workshop.knowledge_tools.http import router as local_router
from studio.apps.thought_workshop.knowledge_tools.reuse import ReusableContent
from studio.apps.thought_workshop.knowledge_tools.schemas import (
    DuplicateIn,
    DuplicateOut,
    TemplateApply,
    TemplateIn,
    TemplateOut,
    TemplatePut,
)
from studio.apps.thought_workshop.schemas.workshop import ThoughtNoteOut

router = APIRouter()


@router.get("/templates", response_model=list[TemplateOut])
async def templates(session: SessionDep, owner_user_id: OwnerDep):
    return await call(ReusableContent(session, owner_user_id).templates())


@router.post("/templates", response_model=TemplateOut)
async def create_template(body: TemplateIn, session: SessionDep, principal: StudioAuth):
    return await call(ReusableContent(session, principal.owner_user_id).create_template(body))


@router.put("/templates/{template_id}", response_model=TemplateOut)
async def put_template(
    template_id: str, body: TemplatePut, session: SessionDep, owner_user_id: OwnerDep
):
    return await call(ReusableContent(session, owner_user_id).update_template(template_id, body))


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
):
    await call(
        ReusableContent(session, owner_user_id).delete_template(template_id, expected_revision)
    )


@router.post("/templates/{template_id}/apply", response_model=ThoughtNoteOut)
async def apply_template(
    template_id: str, body: TemplateApply, session: SessionDep, principal: StudioAuth
):
    return await call(
        ReusableContent(session, principal.owner_user_id, principal.user_id).apply_template(
            template_id, body
        )
    )


@router.post("/notes/{note_id}/duplicate", response_model=DuplicateOut)
async def duplicate_document(
    note_id: str, body: DuplicateIn, session: SessionDep, principal: StudioAuth
):
    return await call(
        ReusableContent(session, principal.owner_user_id, principal.user_id).duplicate(
            note_id, body
        )
    )


router.include_router(local_router)

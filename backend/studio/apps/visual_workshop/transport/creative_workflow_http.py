"""Shared Visual script and design-card transport."""

from fastapi import APIRouter, Request

from studio.apps.visual_workshop.card_regroup import CardRegroupIn, regroup_cards
from studio.apps.visual_workshop.creative_workflow import (
    CardData,
    CardOut,
    CardUpdate,
    CreativeWorkflow,
    ScriptOut,
    ScriptUpdate,
    card_out,
)
from studio.apps.visual_workshop.transport.creative_asset_scope import creative_asset_inspection
from studio.apps.visual_workshop.transport.previs_http import resolve
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter(prefix="/visual-workshop", tags=["visual-workshop"])


@router.get("/projects/{project_id}/script", response_model=ScriptOut)
async def get_visual_script(session: SessionDep, owner: OwnerDep, project_id: str):
    return await resolve(CreativeWorkflow(session, owner).script(project_id))


@router.put("/projects/{project_id}/script", response_model=ScriptOut)
async def put_visual_script(
    session: SessionDep, owner: OwnerDep, project_id: str, body: ScriptUpdate
):
    return await resolve(CreativeWorkflow(session, owner).update_script(project_id, body))


@router.get("/projects/{project_id}/asset-cards", response_model=list[CardOut])
async def list_visual_asset_cards(session: SessionDep, owner: OwnerDep, project_id: str):
    return await resolve(CreativeWorkflow(session, owner).cards(project_id))


@router.post("/projects/{project_id}/asset-cards", response_model=CardOut, status_code=201)
async def create_visual_asset_card(
    request: Request, session: SessionDep, owner: OwnerDep, project_id: str, body: CardData
):
    return await resolve(
        CreativeWorkflow(
            session, owner, creative_asset_inspection(request, session, owner)
        ).save_card(project_id, body)
    )


@router.get("/projects/{project_id}/asset-cards/{card_id}", response_model=CardOut)
async def get_visual_asset_card(
    session: SessionDep, owner: OwnerDep, project_id: str, card_id: str
):
    return card_out(await resolve(CreativeWorkflow(session, owner).card_row(project_id, card_id)))


@router.put("/projects/{project_id}/asset-cards/{card_id}", response_model=CardOut)
async def put_visual_asset_card(
    request: Request,
    session: SessionDep,
    owner: OwnerDep,
    project_id: str,
    card_id: str,
    body: CardUpdate,
):
    return await resolve(
        CreativeWorkflow(
            session, owner, creative_asset_inspection(request, session, owner)
        ).save_card(project_id, body, card_id)
    )


@router.get("/asset-cards", response_model=list[CardOut])
async def list_account_asset_cards(session: SessionDep, owner: OwnerDep):
    return await resolve(CreativeWorkflow(session, owner).cards())


@router.post("/asset-cards", response_model=CardOut, status_code=201)
async def create_account_asset_card(
    request: Request, session: SessionDep, owner: OwnerDep, body: CardData
):
    return await resolve(
        CreativeWorkflow(
            session, owner, creative_asset_inspection(request, session, owner)
        ).save_card(None, body)
    )


@router.post("/asset-cards/regroup", response_model=list[CardOut])
async def regroup_account_asset_cards(session: SessionDep, owner: OwnerDep, body: CardRegroupIn):
    return await resolve(regroup_cards(session, owner, body))


@router.get("/asset-cards/{card_id}", response_model=CardOut)
async def get_account_asset_card(session: SessionDep, owner: OwnerDep, card_id: str):
    return card_out(await resolve(CreativeWorkflow(session, owner).card_row(None, card_id)))


@router.put("/asset-cards/{card_id}", response_model=CardOut)
async def put_account_asset_card(
    request: Request, session: SessionDep, owner: OwnerDep, card_id: str, body: CardUpdate
):
    return await resolve(
        CreativeWorkflow(
            session, owner, creative_asset_inspection(request, session, owner)
        ).save_card(None, body, card_id)
    )

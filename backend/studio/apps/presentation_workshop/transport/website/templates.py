"""Protocol adapters for account templates, examples and explicit binding."""

from fastapi import APIRouter, HTTPException, Query

from studio.apps.presentation_workshop.projects import PresentationError
from studio.apps.presentation_workshop.schemas.document import PresentationProjectOut
from studio.apps.presentation_workshop.templates.binding import apply_change, preview_change
from studio.apps.presentation_workshop.templates.contracts import (
    PresentationExampleIn,
    PresentationExampleList,
    PresentationExampleOut,
    PresentationExamplePut,
    PresentationTemplateIn,
    PresentationTemplateList,
    PresentationTemplateOut,
    PresentationTemplatePut,
    TemplateBundleIn,
    TemplateBundleOut,
    TemplateChangeApply,
    TemplateChangeIn,
    TemplateChangePreview,
    TemplateCreateDocument,
)
from studio.apps.presentation_workshop.templates.library import TemplateLibrary
from studio.apps.presentation_workshop.transport.website.dependencies import PresentationDep

router = APIRouter()


async def run(operation):
    try:
        return await operation
    except PresentationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/templates", response_model=PresentationTemplateList)
async def list_templates(
    projects: PresentationDep,
    query: str = Query("", max_length=120),
    offset: int = Query(0, ge=0),
    limit: int = Query(24, ge=1, le=100),
):
    return await run(TemplateLibrary(projects).list("templates", query, offset, limit))


@router.post("/templates", response_model=PresentationTemplateOut)
async def create_template(projects: PresentationDep, body: PresentationTemplateIn):
    return await run(TemplateLibrary(projects).create("templates", body))


@router.get("/templates/{template_id}", response_model=PresentationTemplateOut)
async def get_template(projects: PresentationDep, template_id: str):
    return await run(TemplateLibrary(projects).get("templates", template_id))


@router.put("/templates/{template_id}", response_model=PresentationTemplateOut)
async def put_template(projects: PresentationDep, template_id: str, body: PresentationTemplatePut):
    return await run(TemplateLibrary(projects).put("templates", template_id, body))


@router.delete("/templates/{template_id}")
async def delete_template(
    projects: PresentationDep,
    template_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    await run(TemplateLibrary(projects).delete("templates", template_id, expected_revision))
    return {"deleted": True}


@router.post("/templates/{template_id}/documents", response_model=PresentationProjectOut)
async def create_from_template(
    projects: PresentationDep, template_id: str, body: TemplateCreateDocument
):
    return await run(TemplateLibrary(projects).create_document("templates", template_id, body))


@router.get("/examples", response_model=PresentationExampleList)
async def list_examples(
    projects: PresentationDep,
    query: str = Query("", max_length=120),
    offset: int = Query(0, ge=0),
    limit: int = Query(24, ge=1, le=100),
):
    return await run(TemplateLibrary(projects).list("examples", query, offset, limit))


@router.post("/examples", response_model=PresentationExampleOut)
async def create_example(projects: PresentationDep, body: PresentationExampleIn):
    return await run(TemplateLibrary(projects).create("examples", body))


@router.get("/examples/{example_id}", response_model=PresentationExampleOut)
async def get_example(projects: PresentationDep, example_id: str):
    return await run(TemplateLibrary(projects).get("examples", example_id))


@router.put("/examples/{example_id}", response_model=PresentationExampleOut)
async def put_example(projects: PresentationDep, example_id: str, body: PresentationExamplePut):
    return await run(TemplateLibrary(projects).put("examples", example_id, body))


@router.delete("/examples/{example_id}")
async def delete_example(
    projects: PresentationDep,
    example_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    await run(TemplateLibrary(projects).delete("examples", example_id, expected_revision))
    return {"deleted": True}


@router.post("/examples/{example_id}/documents", response_model=PresentationProjectOut)
async def create_from_example(
    projects: PresentationDep, example_id: str, body: TemplateCreateDocument
):
    return await run(TemplateLibrary(projects).create_document("examples", example_id, body))


@router.post("/projects/{project_id}/template/preview", response_model=TemplateChangePreview)
async def preview_template_change(
    projects: PresentationDep, project_id: str, body: TemplateChangeIn
):
    async def preview():
        return (await preview_change(TemplateLibrary(projects), project_id, body))[1]

    return await run(preview())


@router.post("/projects/{project_id}/template/apply", response_model=PresentationProjectOut)
async def apply_template_change(
    projects: PresentationDep, project_id: str, body: TemplateChangeApply
):
    return await run(apply_change(TemplateLibrary(projects), project_id, body))


@router.post("/library/import", response_model=TemplateBundleOut)
async def import_template_bundle(projects: PresentationDep, body: TemplateBundleIn):
    return await run(TemplateLibrary(projects).import_bundle(body))

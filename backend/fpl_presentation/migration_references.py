"""Verify historical project, template and example pins against their original documents."""

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select

from app.apps.presentation_workshop.asset_references import document_references
from app.apps.presentation_workshop.models import PresentationAssetReference, PresentationProject
from app.apps.presentation_workshop.schemas.document import PresentationDocument
from app.apps.presentation_workshop.templates.library import template_document
from app.apps.presentation_workshop.templates.models import (
    PresentationExample,
    PresentationExampleAsset,
    PresentationTemplate,
    PresentationTemplateAsset,
)
from app.apps.presentation_workshop.templates.schema import TemplateDefinition
from fpl_runtime.presentation_migration import (
    REFERENCE_DATASETS,
    Projection,
    ProjectionBatch,
    ProjectionPage,
)

from .migration_records import inventory, list_rows, page_for

REFERENCE_MODELS = {
    "project": (
        PresentationProject,
        PresentationAssetReference,
        PresentationAssetReference.project_id,
    ),
    "template": (
        PresentationTemplate,
        PresentationTemplateAsset,
        PresentationTemplateAsset.template_id,
    ),
    "example": (
        PresentationExample,
        PresentationExampleAsset,
        PresentationExampleAsset.example_id,
    ),
}


async def inventory_projections(sessions, plan, kind):
    model, ref, identity = REFERENCE_MODELS[kind]
    async with sessions() as db:
        orphan_count = await db.scalar(
            select(func.count())
            .select_from(ref)
            .outerjoin(model, identity == model.id)
            .where(model.id.is_(None))
        )
    if orphan_count:
        raise HTTPException(409, {"code": "migration_presentation_reference_orphaned"})
    return await inventory(sessions, plan, model)


async def export_projections(sessions, plan, dataset, owner, after):
    kind = REFERENCE_DATASETS[dataset]
    model, ref, identity = REFERENCE_MODELS[kind]
    records = []
    async with sessions(info={"owner_user_id": str(owner)}) as db:
        rows = await list_rows(db, model, owner, after)
        for row in rows[:1]:
            try:
                if kind == "template":
                    document = template_document(TemplateDefinition.model_validate(row.definition))
                else:
                    document = PresentationDocument.model_validate(row.document)
            except ValidationError:
                raise HTTPException(
                    409, {"code": "migration_presentation_record_invalid"}
                ) from None
            expected = set(document_references(document))
            prior = set(await db.scalars(select(ref.asset_id).where(identity == row.id)))
            if prior != expected:
                raise HTTPException(409, {"code": "migration_presentation_references_changed"})
            records.append(Projection(id=row.id, revision=row.revision, asset_ids=sorted(prior)))
    return page_for(
        plan,
        owner,
        after,
        dataset=dataset,
        batch_type=ProjectionBatch,
        page_type=ProjectionPage,
        records=tuple(records),
        more=len(rows) > 1,
    )

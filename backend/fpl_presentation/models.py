"""Presentation owns documents and the durable outcome of its Assets references."""

from sqlalchemy.orm import DeclarativeBase

from app.apps.presentation_workshop.models import PresentationProject
from app.apps.presentation_workshop.templates.models import PresentationTemplate
from app.runtime.project_operations import ProjectOperationReceipt
from fpl_runtime.reference_records import ReferenceMutationFields


class PresentationRetentionBase(DeclarativeBase):
    pass


class PresentationReferenceMutation(ReferenceMutationFields, PresentationRetentionBase):
    __tablename__ = "presentation_reference_mutations"


MODELS = (
    PresentationProject,
    PresentationTemplate,
    ProjectOperationReceipt,
    PresentationReferenceMutation,
)

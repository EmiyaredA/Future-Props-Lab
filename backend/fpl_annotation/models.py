"""Annotation owns documents and the durable outcome of its Assets references."""

from sqlalchemy.orm import DeclarativeBase

from app.apps.audio_annotation.models import (
    AudioAnnotationDocument,
    AudioAnnotationProject,
    AudioAnnotationWaveform,
)
from app.runtime.project_operations import ProjectOperationReceipt
from fpl_runtime.reference_records import ReferenceMutationFields


class AnnotationRetentionBase(DeclarativeBase):
    pass


class AnnotationReferenceMutation(ReferenceMutationFields, AnnotationRetentionBase):
    __tablename__ = "annotation_reference_mutations"


MODELS = (
    AudioAnnotationProject,
    AudioAnnotationDocument,
    AudioAnnotationWaveform,
    ProjectOperationReceipt,
    AnnotationReferenceMutation,
)

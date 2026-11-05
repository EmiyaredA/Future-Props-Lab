"""Annotation owns documents and the durable outcome of its Assets references."""

from sqlalchemy.orm import DeclarativeBase

from studio.apps.asset_library.clients.reference_records import ReferenceMutationFields
from studio.apps.audio_annotation.models import (
    AudioAnnotationDocument,
    AudioAnnotationProject,
    AudioAnnotationWaveform,
)
from studio.runtime.database.project_operations import ProjectOperationReceipt


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

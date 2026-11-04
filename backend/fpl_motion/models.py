"""Durable source decisions for project file layout changes."""

from sqlalchemy.orm import DeclarativeBase

from fpl_runtime.reference_records import ReferenceMutationFields


class MotionLifecycleBase(DeclarativeBase):
    pass


class MotionReferenceMutation(ReferenceMutationFields, MotionLifecycleBase):
    __tablename__ = "motion_reference_mutations"

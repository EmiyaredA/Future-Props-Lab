"""Thought-owned prospective asset pins and source transaction outcomes."""

from sqlalchemy.orm import DeclarativeBase

from fpl_runtime.reference_records import ReferenceMutationFields


class RetentionBase(DeclarativeBase):
    pass


class ThoughtReferenceMutation(ReferenceMutationFields, RetentionBase):
    __tablename__ = "thought_reference_mutations"

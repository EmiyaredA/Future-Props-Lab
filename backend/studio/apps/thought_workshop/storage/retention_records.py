"""Thought-owned prospective asset pins and source transaction outcomes."""

from sqlalchemy.orm import DeclarativeBase

from studio.apps.asset_library.clients.reference_records import ReferenceMutationFields


class RetentionBase(DeclarativeBase):
    pass


class ThoughtReferenceMutation(ReferenceMutationFields, RetentionBase):
    __tablename__ = "thought_reference_mutations"

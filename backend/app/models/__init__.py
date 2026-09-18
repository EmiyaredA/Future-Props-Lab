"""Shared persistence shapes not yet owned by a vertical package."""

from app.models.project_operations import ProjectOperationReceipt as ProjectOperationReceipt
from app.runtime.orm_base import Base

__all__ = [
    "Base",
    "ProjectOperationReceipt",
]

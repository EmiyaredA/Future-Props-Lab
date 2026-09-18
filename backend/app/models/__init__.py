"""Shared persistence shapes not yet owned by a vertical package."""

from app.models.files import VisualAsset, VisualAssetFolder, VisualProjectAssetReference
from app.models.project_operations import ProjectOperationReceipt as ProjectOperationReceipt
from app.runtime.orm_base import Base

__all__ = [
    "Base",
    "ProjectOperationReceipt",
    "VisualAsset",
    "VisualAssetFolder",
    "VisualProjectAssetReference",
]

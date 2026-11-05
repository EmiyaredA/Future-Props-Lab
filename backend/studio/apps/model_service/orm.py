"""Declarative registry owned only by the independent studio.apps.model_service service."""

from sqlalchemy.orm import DeclarativeBase


class ModelsBase(DeclarativeBase):
    pass

"""Declarative registry owned only by the independent fpl_models service."""

from sqlalchemy.orm import DeclarativeBase


class ModelsBase(DeclarativeBase):
    pass

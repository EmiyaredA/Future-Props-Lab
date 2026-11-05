"""Declarative registry owned only by the independent studio.apps.integrations service."""

from sqlalchemy.orm import DeclarativeBase


class IntegrationsBase(DeclarativeBase):
    pass

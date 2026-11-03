"""Declarative registry owned only by the independent fpl_integrations service."""

from sqlalchemy.orm import DeclarativeBase


class IntegrationsBase(DeclarativeBase):
    pass

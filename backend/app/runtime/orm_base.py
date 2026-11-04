"""Shared ORM base and opaque cross-service foreign-key references."""

from sqlalchemy import Column, MetaData, String, Table
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


_external_metadata = MetaData()
_external_tables = {
    name: Table(name, _external_metadata, Column("id", String(36), primary_key=True))
    for name in (
        "users",
        "audio_annotation_projects",
        "video_editor_projects",
        "visual_assets",
        "integration_external_connections",
        "model_entries",
        "model_providers",
    )
}


def external_id(table):
    """Keep legacy physical FK names without loading foreign service ORM models."""
    return _external_tables[table].c.id

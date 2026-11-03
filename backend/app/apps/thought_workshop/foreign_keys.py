"""Names for legacy external foreign keys without importing foreign ORM models.

The recovery schema still names the same tables. The isolated Thought migration
omits those foreign keys, and treats the IDs as opaque references.
"""

from sqlalchemy import Column, MetaData, String, Table

_external = MetaData()
_tables = {
    name: Table(name, _external, Column("id", String(36), primary_key=True))
    for name in ("users", "visual_assets", "integration_external_connections")
}


def external_id(table):
    return _tables[table].c.id

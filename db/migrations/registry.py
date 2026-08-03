from __future__ import annotations

from dataclasses import dataclass

from db.migrations.versions import (
    r0001_initial,
    r0002_model_test_conversations,
    r0003_tool_navigation_state,
    r0004_expand_senseaudio_text_catalog,
)


@dataclass(frozen=True)
class Migration:
    migration_id: str
    sql: str


MIGRATIONS = (
    Migration(r0001_initial.MIGRATION_ID, r0001_initial.SQL),
    Migration(
        r0002_model_test_conversations.MIGRATION_ID,
        r0002_model_test_conversations.SQL,
    ),
    Migration(
        r0003_tool_navigation_state.MIGRATION_ID,
        r0003_tool_navigation_state.SQL,
    ),
    Migration(
        r0004_expand_senseaudio_text_catalog.MIGRATION_ID,
        r0004_expand_senseaudio_text_catalog.SQL,
    ),
)

LATEST_MIGRATION_ID = MIGRATIONS[-1].migration_id

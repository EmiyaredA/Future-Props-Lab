"""Explicit Visual database migrations."""

from studio.apps.visual_workshop.storage.migrations.versions.v0001 import SQL
from studio.apps.visual_workshop.storage.migrations.versions.v0002 import SQL as CANVAS_RETENTION
from studio.apps.visual_workshop.storage.migrations.versions.v0003 import SQL as CANVAS_OPERATIONS
from studio.apps.visual_workshop.storage.migrations.versions.v0004 import SQL as SEGMENT_HANDOFFS
from studio.apps.visual_workshop.storage.migrations.versions.v0005 import SQL as MIGRATION_RECEIPTS
from studio.apps.visual_workshop.storage.migrations.versions.v0006 import SQL as SNAPSHOT_IMPORTS
from studio.apps.visual_workshop.storage.migrations.versions.v0007 import (
    SQL as COMPOSITION_DISPATCH,
)
from studio.apps.visual_workshop.storage.migrations.versions.v0008 import SQL as GENERATION_DISPATCH
from studio.apps.visual_workshop.storage.migrations.versions.v0009 import SQL as REVIEW_DISPATCH
from studio.apps.visual_workshop.storage.migrations.versions.v0010 import SQL as ASSISTANT_DISPATCH
from studio.apps.visual_workshop.storage.migrations.versions.v0011 import (
    SQL as RETIRE_VISUAL_DIALOGUE,
)
from studio.apps.visual_workshop.storage.migrations.versions.v0012 import SQL as PREVIS_SCENES
from studio.apps.visual_workshop.storage.migrations.versions.v0013 import SQL as CREATIVE_WORKFLOW
from studio.apps.visual_workshop.storage.migrations.versions.v0014 import SQL as ACCOUNT_ASSET_CARDS
from studio.apps.visual_workshop.storage.migrations.versions.v0015 import (
    SQL as CANVAS_GROUPS_AND_CARDS,
)
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_visual_owned_projects", SQL),
    Migration("0002_canvas_reference_mutations", CANVAS_RETENTION),
    Migration("0003_canvas_operation_receipts", CANVAS_OPERATIONS),
    Migration("0004_visual_segment_handoffs", SEGMENT_HANDOFFS),
    Migration("0005_visual_migration_receipts", MIGRATION_RECEIPTS),
    Migration("0006_visual_snapshot_imports", SNAPSHOT_IMPORTS),
    Migration("0007_visual_composition_dispatches", COMPOSITION_DISPATCH),
    Migration("0008_visual_generation_dispatches", GENERATION_DISPATCH),
    Migration("0009_visual_review_dispatches", REVIEW_DISPATCH),
    Migration("0010_visual_assistant_dispatches", ASSISTANT_DISPATCH),
    Migration("0011_retire_visual_conversations", RETIRE_VISUAL_DIALOGUE),
    Migration("0012_visual_previs_scenes", PREVIS_SCENES),
    Migration("0013_visual_creative_workflow", CREATIVE_WORKFLOW),
    Migration("0014_visual_account_asset_cards", ACCOUNT_ASSET_CARDS),
    Migration("0015_visual_canvas_groups_and_cards", CANVAS_GROUPS_AND_CARDS),
)

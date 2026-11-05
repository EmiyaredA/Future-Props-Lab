"""The Video Editor migration chain."""

from studio.apps.video_editor.storage.migrations.versions import (
    v0001,
    v0002,
    v0003,
    v0004,
    v0005,
    v0006,
    v0007,
    v0008,
    v0009,
    v0010,
    v0011,
    v0012,
)
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_video_editor", v0001.SQL),
    Migration("0002_video_timeline_media", v0002.SQL),
    Migration("0003_video_reference_mutations", v0003.SQL),
    Migration("0004_video_asset_intakes", v0004.SQL),
    Migration("0005_video_media_dispatch", v0005.SQL),
    Migration("0006_video_render_dispatch", v0006.SQL),
    Migration("0007_video_motion_handoffs", v0007.SQL),
    Migration("0008_video_import_batches", v0008.SQL),
    Migration("0009_video_segment_delivery", v0009.SQL),
    Migration("0010_video_migration_receipts", v0010.SQL),
    Migration("0011_video_historical_media", v0011.SQL),
    Migration("0012_galgame_handoff_fingerprints", v0012.SQL),
)

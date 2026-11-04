from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL as V0001
from .versions.v0002 import SQL as V0002
from .versions.v0003 import SQL as V0003
from .versions.v0004 import SQL as V0004

MIGRATIONS = (
    Migration("0001_rendering", V0001),
    Migration("0002_motion_render_jobs", V0002),
    Migration("0003_video_media_jobs", V0003),
    Migration("0004_video_export_jobs", V0004),
)

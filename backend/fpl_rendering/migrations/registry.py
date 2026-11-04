from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL as V0001
from .versions.v0002 import SQL as V0002
from .versions.v0003 import SQL as V0003

MIGRATIONS = (
    Migration("0001_rendering", V0001),
    Migration("0002_motion_render_jobs", V0002),
    Migration("0003_video_media_jobs", V0003),
)

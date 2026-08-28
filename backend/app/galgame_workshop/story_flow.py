from __future__ import annotations

STORY_TERMINATOR_TYPES = frozenset({"endChapter", "returnToEntry"})
TIMED_ROUTE_BOUNDARY_TYPES = STORY_TERMINATOR_TYPES | {"branch"}

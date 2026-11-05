"""Explicit schema for Agent Runtime connection jobs."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as REVIEW_JOBS

MIGRATIONS = (
    Migration("0001_agent_runtime_connections", SQL),
    Migration("0002_agent_runtime_visual_reviews", REVIEW_JOBS),
)

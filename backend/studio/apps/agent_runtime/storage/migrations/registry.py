"""Explicit schema for Agent Runtime connection jobs."""

from studio.apps.agent_runtime.storage.migrations.versions.v0001 import SQL
from studio.apps.agent_runtime.storage.migrations.versions.v0002 import SQL as REVIEW_JOBS
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_agent_runtime_connections", SQL),
    Migration("0002_agent_runtime_visual_reviews", REVIEW_JOBS),
)

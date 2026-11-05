"""Workbench schema sequence, independent of legacy migrations."""

from studio.apps.agent_workbench.storage.migrations.versions.v0001 import SQL
from studio.apps.agent_workbench.storage.migrations.versions.v0002 import (
    SQL as EXECUTION_TRANSCRIPTS,
)
from studio.apps.agent_workbench.storage.migrations.versions.v0003 import SQL as WORKBENCH_PROJECTS
from studio.apps.agent_workbench.storage.migrations.versions.v0004 import SQL as EXECUTION_JOBS
from studio.apps.agent_workbench.storage.migrations.versions.v0005 import SQL as QUEUE_ACTIVITY
from studio.apps.agent_workbench.storage.migrations.versions.v0006 import SQL as HISTORY_IMPORT
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_agents", SQL),
    Migration("0002_workbench_transcripts", EXECUTION_TRANSCRIPTS),
    Migration("0003_workbench_projects", WORKBENCH_PROJECTS),
    Migration("0004_workbench_execution_jobs", EXECUTION_JOBS),
    Migration("0005_workbench_queue_activity", QUEUE_ACTIVITY),
    Migration("0006_workbench_history_import", HISTORY_IMPORT),
)

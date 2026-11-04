"""Explicit schema for Agent Runtime connection jobs."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_agent_runtime_connections", SQL),)

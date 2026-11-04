"""Versioned schema for the Annotation owner."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_annotation", SQL),)

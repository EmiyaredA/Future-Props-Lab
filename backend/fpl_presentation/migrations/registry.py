"""Versioned schema for the Presentation owner."""

from fpl_runtime.migrations import Migration

from .versions import v0001, v0002

MIGRATIONS = (
    Migration("0001_presentation", v0001.SQL),
    Migration("0002_presentation_examples", v0002.SQL),
)

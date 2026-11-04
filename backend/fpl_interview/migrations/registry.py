"""Explicit schema registration for Interview."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL as INITIAL
from .versions.v0002 import SQL as NATIVE_LEASES

MIGRATIONS = (
    Migration("0001_interview", INITIAL),
    Migration("0002_interview_native_leases", NATIVE_LEASES),
)

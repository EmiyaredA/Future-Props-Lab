# Agent Note: Pass prepared Thought asset views to writes

Status: implemented

## Problem

Archive import and community writes replaced the session's asset lookup
with temporary metadata. Validation depended on mutation order and the
lifetime of that session dictionary entry.

## Decision

Archive persistence and community writes pass their sealed or prepared
asset view to the operation being validated. Community table preparation
returns the view to the write callback after checking the current grant.

## Alternatives considered

Restoring the old session entry in a finally block would retain the hidden
dependency and would still allow nested writes to see the wrong view.

## Consequences

Archive and community validation use metadata already authorized for the
specific write. Transaction boundaries and reference recovery are preserved.

## Verification

Archive, community and table regressions exercise the shared write paths,
including reference preparation and recovery.

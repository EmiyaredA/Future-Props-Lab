# Agent Note: Preserve Visual generation history and batch membership

Status: implemented

## Problem

The Visual standalone database needs the generation records that back its output history and canvas provenance. Current documents alone lose provider task IDs, attempt timestamps and batch membership.

## Decision

The Visual maintenance transport exports task and batch rows in separate datasets after their projects. It preserves IDs, source snapshots, provider receipt fields, execution status, asset IDs and revisions. Batch import verifies each child task against the same account and project. Canvas pin export blocks when a saved node or output references a generation task absent from that project.

## Alternatives considered

Rebuilding generation history from the current canvas would lose retired nodes and provider receipts. Accepting any child ID would let a batch import succeed while its task belongs to a different project or was omitted.

## Consequences

The history transfer retains the recorded outcome and does not submit a task to a provider. The shared coverage report recognizes both datasets. Assets originals still use their separately verified byte transfer.

## Verification

The isolated Visual history rehearsal migrates four saved generation tasks and their composite batch from a stopped legacy snapshot. It compares membership, provider receipt IDs, submitted timestamps, asset IDs and revisions, repeats the import, and restores the legacy website.

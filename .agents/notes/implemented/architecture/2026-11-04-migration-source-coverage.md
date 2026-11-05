# Agent Note: Gate migration against actual sealed source tables

Status: implemented

## Problem

A transfer report can succeed for its registered datasets while leaving other populated source tables behind. Release approval needs an inventory tied to the same frozen database and ownership manifest.

## Decision

The read-only coverage command binds the source revision, database digest and snapshot seal to the migration plan. It compares the actual SQLite table list and counts with the ownership manifest and registered transfer functions. Platform settings are counted by owner partition. Known index shadow tables are accounted for by their derived parent. The command reports populated uncovered tables and pending rebuilds with a failing exit status.

## Alternatives considered

- Comparing only the expected schema would miss legacy tables and populated historical partitions.
- Reading values into the report would expose user data or secrets.

## Consequences

Coverage verifies registration and source counts. Migration receipts, restored business behavior and derived index rebuilds require their own evidence.

## Verification

The real isolated compatibility snapshot shows registered account, Assets and Director datasets. The test confirms that populated interview history and an outstanding search index still appear as pending, and that an altered manifest seal is refused.

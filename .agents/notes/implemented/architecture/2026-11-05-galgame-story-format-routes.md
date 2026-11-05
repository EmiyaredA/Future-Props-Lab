# Agent Note: Galgame Story import and format upgrade routes

Status: implemented

## Problem

The independent Story owner accepted current documents and edit batches. The published legacy JSON import and account-level stored-format migration still depended on the compatibility website.

## Decision

Share the legacy decoder, schema conversion and account inventory between the two assemblies. A file import prepares Story asset retention with the original import authority and persists the converted document, index and source result through the existing Story write transaction. The stored-format upgrade preserves the same indexed asset IDs. It checks the entire selected batch under the write lock before changing any document revisions.

## Alternatives considered

Routing an import through the public PUT endpoint would exchange an upload-specific authority for a different operation. Blindly upgrading stored JSON would allow a malformed migration projection to become harder to detect.

## Consequences

The published Story import, migration status and migration run operations work on the independent Galgame database. Existing migration counters and optimistic revision behavior remain available. A stored Story whose normalized asset set differs from its verified index blocks the batch.

## Verification

The signed API rehearsal covers UTF-8 BOM import, invalid JSON, stale revision, stored legacy migration, mismatch rollback and repeat execution. Compatibility migration tests cover all supported source schema versions.

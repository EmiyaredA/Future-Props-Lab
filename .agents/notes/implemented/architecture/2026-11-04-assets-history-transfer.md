# Agent Note: Transfer the Assets file library and verify original bytes

Status: implemented

## Problem

Assets must keep historical identity, account and project scope, folder relationships and exact originals while moving out of the shared SQLite database.

## Decision

The read-only legacy maintenance application exports account-scoped records and verifies the folder tree. Folders transfer in parent-first order. Imports reject missing or mismatched parents and save each batch receipt in the same transaction as its records. Originals stream into staged files. Publication verifies size and SHA256, preserves existing content on replay and persists a receipt. Both manifests are read again before the relay reports success.

## Alternatives considered

- Copying the database or accepting user-selected paths would bypass ownership and relationship validation.
- Trusting the SQLite byte count would leave modified or missing originals undetected.

## Consequences

Unexpected or missing active originals stop promotion. Matching legacy upgrade copies stay in the full rollback bundle. Cross-service asset relations require a later verified rebuild after their business owners import.

## Verification

The compatibility website creates a nested library folder and uploads a file using the published API. The snapshot rehearsal migrates folder and asset records, rejects a corrupt upload, transfers and replays the exact original and verifies the bytes again after restoring the compatibility website.

# Agent Note: Galgame Story history transfer

Status: implemented

## Problem

The standalone Galgame database can serve new Stories, but a separate target needs the existing project records, document versions, snapshots and metadata from the stopped compatibility website. Files used only by an older snapshot must remain available.

## Decision

Expose typed, paginated maintenance datasets for Galgame projects, Stories, snapshots, original asset links, asset metadata and ASR settings. Transfer original rows through the owning application's authenticated loopback API and verify each batch by readback. Derive the Story pins from the current reference index and all snapshots. The Assets importer verifies the account, project, media type and the file's durable SHA256 receipt before committing pins. The coordinator compares complete source and target original manifests and requires matching counts for projects, Stories and pin projections.

## Alternatives considered

Copying the shared SQLite database to the Galgame service would expose other services' tables. Rebuilding pins from only the current Story would lose protection for files used in a saved snapshot.

## Consequences

The six datasets keep source IDs, timestamps, revisions and Story payloads. The historical transfer can resume using the same sealed source and migration plan. Operation receipts and external job artifacts use separate datasets.

## Verification

An isolated compatibility site creates a Story and a saved snapshot, then removes the file from the current Story. Four maintenance processes verify that missing original bytes block the import, transfer with exact digests, replay the same batches, and read back every record. The original website then starts from a verified restored snapshot and returns the same Story and original PNG.

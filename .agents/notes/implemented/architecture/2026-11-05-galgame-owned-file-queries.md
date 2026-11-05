# Agent Note: Galgame reads scoped Assets file snapshots

Status: implemented

## Problem

Galgame lists, overview and package reports previously joined its metadata with the shared file table and checked paths in the same process. The independent owner needs to keep those response shapes while Assets controls originals and their availability.

## Decision

Galgame sends a signed, digest-bound query for one owned project. Assets reads project files and only those additional account files currently retained by the exact Story projection. The owner combines the returned metadata with its Story and Galgame metadata. Both assemblies reuse the filename preflight and package analysis.

## Alternatives considered

Requesting the entire account library would enlarge the grant and let Galgame see unrelated file records. Copying file metadata into Galgame would require synchronizing storage state after every upload and removal.

## Consequences

The existing asset list, overview, package manifest and import preview work through the independent project service. The private reply contains no storage path. Prepared pins cover the interval before a Story reference receipt settles.

## Verification

The signed integration test checks project filtering, retained library files, preview collision handling, package inclusion, cross-account exclusion, same-account unretained exclusion and rejection of a changed query body. Compatibility assets and service image boundary tests run against the same package analysis.

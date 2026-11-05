# Agent Note: Annotation creation ports

Status: implemented

## Problem

Annotation creation, transcript normalization, media probing and SQL writes shared one project
component. A replacement store therefore also had to reproduce business conversion rules, and
creation tests could not run without a database and filesystem.

## Decision

`CreateProject` owns creation, JSON import and completed-transcription import. It receives an
owner, ID factory, creation input port and atomic creation store. Pure rules validate audio
limits, documents and transcript conversion. The input adapter owns borrowed content and media
inspection; no database session, vendor result or local path enters the use case.

`ProjectRecords` moves to `storage/projects.py`. Its creation operation atomically persists the
project, document, waveform and reference delivery. The transcription lease encloses the entire
operation so the adapter can distinguish rollback from successful publication. Unknown commit
outcomes do not trigger automatic recreation. Both website assemblies bind the same use case.

## Alternatives considered

- Moving the original project class without extracting creation would preserve mixed ownership.
- Splitting project, document and waveform writes into independent save ports would weaken the
  existing atomic operation and complicate compensation.

## Consequences

Memory and SQLite adapters use the same creation calls. Existing HTTP, table and file formats
remain unchanged. Query, deletion, saved transcription and export adapters still need subsequent
decoupling. The compatibility source adapter still owns cross-table asset staging; this batch
does not claim completion of all annotation or cross-application boundaries.

## Verification

- Creation contract runs against memory, compatibility website SQLite and independent SQLite:
  creation/import, foreign-owner rejection, duration rejection and lease cleanup after failure.
- Annotation API, independent API, transcription protocol, editing ports and Studio boundaries:
  49 passed. All databases and inputs are isolated test fixtures.
- OpenAPI and deployment ownership stale checks pass; all 23 prepared source closures load their
  service application and CLI. This is source-closure validation, not Docker image execution.

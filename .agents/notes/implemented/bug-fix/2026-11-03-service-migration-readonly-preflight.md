# Agent Note: Reject foreign or drifted service databases before writable setup

Status: implemented

## Problem

Service migration currently checks only whether an existing database has a registry before opening it writable. Journal mode changes precede ownership/checksum validation, so a rejected database can still have its header changed. History comparison also ignores stored positions, and read-only URI paths do not escape fragment/query characters.

## Decision

Validate the complete applied prefix, including positions, ownership, versions and checksums, through an escaped read-only URI before any writable setup. Repeat validation on the opened connection before journal or schema changes. Startup requires the complete exact registry; explicit migrations accept only a valid prefix. Keep all registered migration SQL unchanged.

Checkpointed databases with no WAL use an immutable read to avoid creating empty WAL/SHM auxiliaries. Existing WAL uses normal read-only SQLite locking and visibility, including through resolved aliases; immutable mode must not hide committed WAL history. Maintenance still requires the service lock and stopped writers. Live readiness only checks migration history, which is fixed for a running release.

## Alternatives considered

- Restoring journal mode after rejection still modifies a database the command does not own.
- Relying only on deployment path naming does not validate database ownership.
- Rewriting historical registry positions would hide drift rather than reject it.

## Verification

Temporary databases reproduce rejected foreign/checksum cases in DELETE journal mode and assert unchanged bytes, mode and sidecar files. Reject noncontiguous history positions in both startup and migration checks. Verify paths containing spaces, fragments and query characters, valid upgrades, idempotence and existing service migrations.

Repeat rejected-history checks for checkpointed WAL databases and verify committed history still resident in an existing WAL remains visible without changing database/WAL bytes. SQLite documents that read-only WAL access may need auxiliary files, and that immutable mode disables locking and change detection: [WAL read-only behavior](https://www.sqlite.org/wal.html#read_only_databases), [URI parameters](https://www.sqlite.org/uri.html#uriimmutable).

The initial regression reproduces four failures before the fix; the WAL follow-up reproduces auxiliary creation and verifies the guarded optimization. Thirty-five focused storage, Models/Assets migration, retention and Rendering checks pass. The final full backend suite passes 2037 tests with four conditional skips. All seven implemented images rebuild; synthetic seven-container and headless-browser acceptance `fpl-isolated-agents-c99f192791` passes, including Portal stop/recovery, signed service observations, account isolation, native collection, media processing and responsive themes. Python lint/format, Agent Note and protected-document checks pass. Registered migration SQL and formal data remain unchanged.

## Consequences

Foreign, drifted and mispositioned histories are rejected before writable setup. Escaped paths identify the intended file. Checkpointed databases do not gain empty WAL auxiliaries merely from rejected inspection, and existing WAL history is not hidden by immutable reads. Owning service maintenance locks and normal SQLite live-read semantics remain required.

## Risks

The migration entry still requires the owning service's maintenance lock and stopped writers. This change neither repairs history nor authorizes formal migration. All direct database fixture construction is confined to temporary test databases.

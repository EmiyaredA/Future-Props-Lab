# Agent Note: Seal and rehearse restoration of the compatibility website

Status: implemented

## Problem

The service migration needs a recovery bundle tied to the old site revision. A copy taken while writes are still active or an unchecked restore can leave the old website without usable account data, credentials or files.

## Decision

The snapshot command acquires the existing website lock, checks open SQLite handles and requires a settled WAL. An immutable read-only connection verifies integrity, foreign keys and every migration checksum. The runtime tree and the original private TOML are copied to a private staging directory and checked against an exact inventory before publication. The manifest seal and source revision are required for restoration. The restore command verifies the sealed snapshot again and publishes into a fresh directory.

## Alternatives considered

- Copying only SQLite would miss files and the key needed to decrypt legacy credentials.
- Restoring directly over the original runtime would remove the ability to verify the recovery copy before use.
- Using the normal migration check would open the database through a write-capable startup path.

## Consequences

The original runtime and snapshot stay separate from the restored bundle. Internal relative links and empty directories are included. An external or broken link blocks verification. The ephemeral agent IPC socket does not form part of the persistent file tree. The first rehearsal covers Identity and Tools data, alongside the compatibility website recovery path.

## Verification

The test starts the compatibility website with isolated configuration and seeds its account, tool state and avatar through product operations. The live lock prevents backup. Once stopped, the test transfers Identity and Tools from the sealed snapshot, checks repeated imports, then starts the compatibility website again from a verified restore. Its original session, account, navigation record and avatar bytes are recovered. An altered file, seal or source revision prevents publication.

# Agent Note: Website shutdown settles SQLite WAL

Status: implemented

## Problem

The editing migration rehearsal could find committed frames in a nonempty WAL after the legacy website stopped. The backup verifier intentionally refuses such a source because immutable SQLite reads ignore WAL. In the isolated reproduction the website had stopped its runners and returned every SQLAlchemy connection before disposing the pool.

## Decision

The compatibility application's normal shutdown asks its own SQLite connection to finish the WAL checkpoint after background writers stop. It keeps the normal website lock for the duration. Busy checkpoint results surface as shutdown failures. The snapshot tool retains its read-only WAL guard.

## Alternatives considered

Ignoring the WAL in the backup could omit committed edits. Repairing the source from an offline migration utility would bypass the website's ownership of its database. Waiting an arbitrary interval before backup leaves the storage state unverified.

## Consequences

Shutdown can now confirm committed frames are in the main database before releasing the data lock. If a reader holds the checkpoint open, the remaining WAL still blocks snapshot creation and the service reports the reason.

## Verification

The isolated editing rehearsal stops the real old website immediately after generating and downloading results, seals its runtime directory, migrates the history and verified files, and restarts the old website from that snapshot.

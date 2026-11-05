# Agent Note: Annotation website import transaction

Status: implemented

## Problem

Website transcription import staged and flushed an Asset row before probing media duration and
validating transcript conversion. This unnecessarily kept a write transaction through media I/O.
The annotation application also directly loaded other applications' ORM models for this bridge.

## Decision

Website assembly owns the explicit cross-table adapter. Audio metadata reads live in
`annotation_sources.py`; `annotation_imports.py` binds completed Model task snapshots to the
creation input port. The application no longer contains its old `legacy_sources.py` adapter.

Private originals are probed and validated before copying. Copy uses deferred persistence outside
a database transaction, then adds the Asset record to the same session as the atomic Annotation
creation. Cancellation waits for the copy to finish before removing output. The borrowed source
rolls back uncommitted writes on exit and queries the staged identity: committed bytes survive a
lost acknowledgement; uncommitted bytes are removed. An unavailable outcome check retains bytes
for reconciliation rather than guessing that the commit failed.

## Alternatives considered

- Keeping a flushed Asset row while probing media preserves a long write transaction.
- Committing the Asset separately would lose the compatibility website's cross-table atomicity.
- Deleting staged bytes for every exception could corrupt a successfully committed project.

## Consequences

The standalone service keeps its existing source publication and reference protocol. Both entry
points still consume the same creation rules. No migration, table or file format changes. This
bridge is explicitly an assembly adapter, not a shared application storage API.

## Verification

- Website and independent Annotation API, transcription protocol and Studio boundaries: 36 passed.
- Real isolated website transaction checks prove probe and copy occur outside SQL transactions
  and a commit acknowledgement failure preserves committed bytes and the readable project.
- Controlled cancellation waits for the copy producer and removes its output: 2 recovery tests
  passed. The existing failed-project-creation API test still verifies no orphan Asset or file.

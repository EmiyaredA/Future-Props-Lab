# Agent Note: Annotation deletion and saved audio ports

Status: implemented

## Problem

Saved audio export accessed the project's private asset loader and source adapter, and HTTP
handlers passed database sessions and staging paths into the workflow. Deletion combined its
initial business version decision with SQL and reference delivery.

## Decision

`DeleteProject` checks the owned snapshot and invokes one atomic deletion port. The storage
adapter rechecks CAS after reference preparation, deletes children and edit receipts with the
root and records reference delivery in the same transaction. It never deletes the original audio.

`SavedAudio` reads a saved document revision before rendering JSON/SRT or requesting a WAV clip.
Its explicit media and recognition ports accept IDs, ranges, bytes and typed commands. Rendering
uses an injected clock. Native paths, source borrowing, temporary directories and stream cleanup
remain in adapters; media I/O follows release of database reads. Recognition returns a candidate
and does not mutate the editor's document or silently retry unknown model results.

Both assemblies bind these components. HTTP no longer passes Session or staging paths into saved
audio operations. The original mixed exports module is removed without a forwarding layer.

## Alternatives considered

- Exposing storage internals as public properties would retain concrete coupling.
- Putting clipping into the rule module would still require native filesystem knowledge in tests.
- Automatically saving recognized text would bypass the existing draft and document CAS boundary.

## Consequences

Deletion, rendering and saved recognition can be tested without SQL or real providers. The local
media adapter remains a replaceable FFmpeg boundary. Direct uploaded transcription and website
cross-table source adapters still require later work; this batch does not declare full application
decoupling or final architecture acceptance.

## Verification

- Annotation website/independent APIs, transcription protocol and Studio boundaries: 36 passed.
- Creation/deletion contracts for memory and both SQLite adapters plus saved-audio contracts for
  byte stub and real media adapter: 19 passed. Tests cover stale revision, missing segment,
  deletion CAS recheck, source retention, candidate-only results and cleanup on failure/cancellation.
- Official knowledge import package stale check passes. Inputs and databases are isolated; no
  real provider or persistent application data is used.

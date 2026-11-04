# Agent Note: Share archive validation and reference planning

Status: implemented

## Problem

Thought archives can refer to cover files, templates, deleted documents and attachments that only appear in prior document or table states. The independent importer needs these references and the new resource IDs before it opens its write transaction.

## Decision

Keep bounded ZIP extraction in Thought and share only the safe member predicate with the project snapshot reader. Preallocate knowledge base, note and template IDs through one archive plan. Calculate each initial reference set from the validated documents and histories, and omit the source home page when importing into an existing library. The shipped official package uses the same plan to prepare its empty reference sets before writing.

## Alternatives considered

- Checking only current documents would miss historical assets.
- Deriving the reference plan from inserted rows would put remote preparation after the source starts writing.
- Keeping extraction in the compatibility adapter would make the independent importer load the old Assets storage and ORM.

## Consequences

Assets keeps archive bytes outside the visible library in a batch bound to the source checksum and per-file descriptors. Sealing validates the complete file list and initial projections. A confirmed commit publishes both together in Assets. A confirmed abort records a terminal decision and queues staged bytes for cleanup. The independent account archive route delegates staging and sealing from the original authenticated write. A domain-separated peer signature authenticates source decisions and target receipts, with each decision bound to the account, batch and input digest. Thought commits the import result and settlement outcome together. Retries reuse the same IDs and sealed manifest, and the worker settles committed or aborted batches after browser authorization ends. Only terminal batches with confirmed settlement are eligible for scratch cleanup. The compatibility importer continues to save its assets and imported content in a shared transaction.

## Verification

Archive round-trip and malformed ZIP tests cover legacy compatibility. Projection tests cover removed attachments and skipped source home pages. The independent official import verifies prepared references and replay against the actual Identity and Assets services.

Assets tests cover concurrent duplicate file staging, cross-account denial, changed bytes, abort cleanup and a lost settlement acknowledgement followed by a reopened service connection and replay. The migration upgrade test verifies the preceding Assets schema still upgrades with existing data.

The isolated HTTP test drives the existing multipart endpoint and real Identity and Assets authorization. It drops each of the stage, seal and publish responses in turn, restarts Thought, replays the request and reads the historical attachment back through the backup API. The destination-library test exercises stale revisions and confirms the existing home page is retained.

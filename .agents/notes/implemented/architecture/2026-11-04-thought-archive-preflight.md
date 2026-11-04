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

The account archive route still requires an Assets-owned staged batch and confirmed publication outcome before independent deployment can expose it. The compatibility importer continues to save its assets and imported content in a shared transaction.

## Verification

Archive round-trip and malformed ZIP tests cover legacy compatibility. Projection tests cover removed attachments and skipped source home pages. The independent official import verifies prepared references and replay against the actual Identity and Assets services.

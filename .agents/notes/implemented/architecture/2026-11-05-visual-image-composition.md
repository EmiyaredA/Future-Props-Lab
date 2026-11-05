# Agent Note: Visual image composition

Status: implemented

## Problem

The compatible website renders composition batches using file paths in the shared database. Independent Visual needs both public composition operations, a durable batch, and exact inputs and output settlement across three owners.

## Decision

Visual validates the Canvas revision and queues a plan bound to ordered input IDs, original revisions, sizes and captions. Assets checks the current project scope and provides exact revision originals to Rendering. Rendering runs the same grid layout and font as the compatible website. Visual stages the PNG in Assets and commits the Canvas output, source receipt and pending result together. The batch completes after the Assets receipt. On restart, a saved pending receipt is settled without rendering again.

## Alternatives considered

Copying the rendering font and decoder into Visual would duplicate responsibility for the same image operation. Publishing a batch as completed before settlement could expose a result ID without a downloadable file.

## Consequences

Only deterministic grid computation may repeat after interruption. The Canvas retains active composition inputs, and published output history retains the exact source references. Source migration rejects queued or processing compatible compositions so that an unbound legacy batch cannot become stuck in the target. A removed result node ends the native attempt with a failed batch and leaves no unclaimed original.

## Verification

Isolated service tests exercise the published routes, stale Canvas revision, cross-project grant denial, a failed render, retry, lost Assets acknowledgement, process restart, exact output pixels and a single history record. Six-service Compose run fpl-visual-composition-b84cb6342b paused Rendering, restarted Visual with a persisted batch, then verified the exact PNG and output history after restarting Assets. Chromium exercised the responsive Visual entry and Canvas writes.

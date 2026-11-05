# Agent Note: Visual acceptance video samples

Status: implemented

## Problem

Video sampling previously extracted frames directly from an Assets path and committed each frame with the review in the same database. Independent reviews require exact source video, revision checks and all-or-nothing evidence publication.

## Decision

Visual freezes the owned review and permitted interval. Identity issues one exact versioned Assets source grant and one Rendering plan grant. Rendering deduplicates the actual decoded frame timestamps and returns size-prefixed PNG originals with declared SHA256 digests. Visual streams those frames into one Assets retention intent and applies them to the review with its expected revision. The source decision and evidence links commit together. Assets only publishes the complete sealed group. A new scoped retention set identifies the review separately from aggregate migration retention.

## Alternatives considered

Uncoordinated per-image uploads would leave partially visible evidence after a stale revision or interruption. Decoding inside the Visual write transaction would hold SQLite across long media operations.

## Consequences

The published sample operation retains the legacy interval, decision reset and review CAS. Per-run evidence scopes participate in project deletion and still require same-account originals. Imported read-only review history retains the existing restriction on sampling.

## Verification

An isolated service test uses a real H.264 original and FFmpeg, checks deduplicated sample timestamps and decoded PNG pixels, injects a lost Assets acknowledgement, replays the durable receipt, adds a second interval and checks project deletion. Related compatibility, packaging and ownership tests cover the same published route and historical evidence.

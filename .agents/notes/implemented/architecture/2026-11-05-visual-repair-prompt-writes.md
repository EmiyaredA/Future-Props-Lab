# Agent Note: Visual repair prompt writes

Status: implemented

## Problem

The standalone Visual service could create and read a repair draft, but saving it or applying it to a Canvas prompt version still depended on the compatibility application.

## Decision

Share the repair draft CAS and prompt version construction. The independent Canvas adapter verifies that the set of file references is unchanged and checks the segment handoff fence within the repair transaction. The draft revision, Canvas revision and applied prompt ID commit together.

## Alternatives considered

Treating the prompt as an unrelated Canvas write would allow the draft to appear applied when the Canvas write fails. Rebuilding unchanged Assets references would add a peer round trip and dependency to a text-only change.

## Consequences

The published repair update works against the owned service. A stale Canvas rolls back the draft change. An applied draft cannot add another version on replay.

## Verification

Signed API tests cover a text edit, stale Canvas rollback, saved prompt version, and repeated apply. Existing prompt-version, acceptance, route contract and image closure tests verify shared behavior.

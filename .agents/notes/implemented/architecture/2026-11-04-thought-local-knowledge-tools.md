# Agent Note: Share account-owned Thought knowledge tools across assemblies

Status: implemented

## Problem

The independent Thought browser opens search, references, checkpoints, reading preferences, and library export through existing public operations. These operations were registered only by the compatibility router, which also mounts mutations that require cross-service retention.

## Decision

The account-owned knowledge tool routes live in a shared router. Both assemblies reuse their existing account-bound session dependency and operation schemas. Templates and duplicate mutations remain on their respective write paths so the independent service cannot bypass asset retention. Library export continues to resolve asset metadata through the request-bound port.

## Alternatives considered

- Mounting the compatibility router wholesale would also enable mutations without independent asset retention.
- Copying safe endpoints into a second router would let permissions, error mappings and contracts diverge.

## Consequences

Independent Thought gains search, backlinks, reference resolution, copy preflight, checkpoints, preferences and library snapshots. The library snapshot is the existing user export, while full historical migration still requires its own verified transfer.

## Verification

Every shared operation is compared with the public OpenAPI contract. The isolated HTTP scenario searches a newly created document and exports an owned knowledge base with its cover reference using Identity and Assets.

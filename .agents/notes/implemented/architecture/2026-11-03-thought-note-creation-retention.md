# Agent Note: Retain assets for new Thought documents

Status: implemented

## Problem

New documents can contain library references, and even an empty document needs an initial Assets projection for future updates. Without an initial projection, later independent writes fail closed or files may be deleted before their references are protected.

## Decision

The independent Thought service prepares an account-scoped initial note reference set before either public document creation operation. It validates file ownership, allocates a UUIDv4 document identity, and requests only an initial revision -1 projection using the original request assertion. Identity restricts this authority to the two note creation paths and the initial note projection. Thought then reserves the knowledge base version and commits the document, history and reference outcome together. A known source rollback aborts the prepared intent; uncertain outcomes remain for recovery.

## Alternatives considered

- Preparing references after document creation exposes a file deletion race.
- Skipping the initial empty set leaves future independent updates unable to distinguish a new resource from an unprojected legacy document.
- Allowing creation requests to update existing projections weakens authorization boundaries.

## Consequences

Both independent document creation operations retain their existing public contracts. Historical documents still require verified data import and initial projection. Knowledge base creation, archive/import, community writes, complete service assembly and deployment remain separate work; this change does not migrate production data.

## Verification

Isolated real Identity, Thought and Assets HTTP tests cover both creation paths, referenced and empty files, cross-account rejection, revision conflicts and public contract parity. A concurrent knowledge base update verifies source rollback and remote intent abort. Identity tests reject other resource kinds, versions and malformed identities.

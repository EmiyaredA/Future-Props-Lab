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

Independent Thought gains search, backlinks, reference resolution, copy preflight, checkpoints, preferences and library snapshots. A separate shared router exposes Markdown conversion and document export using the same metadata and download port. These user exports keep their existing format. Full historical migration still requires its own verified transfer.

Additional shared routers expose table queries, model writing, community metadata, favorites and official package preflight, plus account-owned external synchronization records. Remote synchronization operations remain separately mounted. Account ZIP backup collects the manifest under a Thought database snapshot, ends the transaction, then downloads the exact asset versions into bounded staging before writing the ZIP.

Community article permission changes reuse the publication role checks and revision guards. Identity resolves the proposed members before acquiring the Thought writer lock. This operation updates article visibility and membership without modifying the source document or its asset set.

The binding operation uses the same Thought transaction in both assemblies. The independent path delegates each source read to Integrations with the exact note, connection and input digest. Integrations sends the resolved document ID, title and write permission for the binding check. Thought rechecks its note revision and task slots in the writer transaction after the remote calls finish.

A published cover has its own reference set keyed by publication ID. Thought derives this ID from the caller's owned library or verifies the existing publication in the management path. The write checks the prepared publication revision and source cover under the writer lock, then commits publication changes and the reference outcome together. A library cover change therefore preserves the old public cover until the publication is updated. Historical publications need an initial verified reference projection during migration.

## Verification

Every shared operation is compared with the public OpenAPI contract. The isolated HTTP scenario searches and exports a newly created document, converts Markdown, and exports an owned knowledge base with its cover reference using Identity and Assets.

The isolated scenario checks that account backups contain both the manifest and the exact asset bytes obtained through Assets. Contract parity covers the newly shared operations, including the external synchronization task record.

The independent binding scenario uses real Identity and Integrations HTTP routes with a simulated Feishu API. It rejects another account and a read-only target, saves an authorized binding and returns a revision conflict for a stale change.

The publication scenario rejects another account, publishes a covered library and checks the publication pin after the private cover is removed. Updating the publication then releases the independent pin.

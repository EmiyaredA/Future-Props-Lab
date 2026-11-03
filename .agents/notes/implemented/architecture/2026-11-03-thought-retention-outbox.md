# Agent Note: Thought source outcomes retain assets across interrupted saves

Status: implemented

## Problem

A Thought write and an Assets reference update use different databases. Losing a prepare or commit reply must not drop a file referenced by a committed note, history, or template. The shared recovery ORM also used unresolved external string foreign keys that made a fresh independent Thought process fail at its first database flush unless another service's ORM had already been imported.

## Decision

Thought owns `0002_reference_mutations`, a per-account immutable-change outbox. A request obtains an Identity authority bound to the original operation and full change digest, persists it before remote preparation, and records the source outcome within the same transaction as the note or template write. A process-locked startup reconciler marks only abandoned, undecided preparations as aborted; committed and aborted outcomes are delivered idempotently, including after authorization revocation. A lost result is never treated as proof of rollback.

`note_retention.py` prepares the union of prospective files, current note files, note-history files and the multitable journal's retained attachments before invoking the existing CAS note save; permanent purge records an empty final pin set in the same transaction that deletes the note. `template_retention.py` similarly handles template update and deletion. Each releases the source read transaction before calling Identity or Assets and validates referenced metadata before the first writer reservation. Existing legacy methods keep their default commit behavior; their explicit `commit=False` option is only used by the independent boundary.

Identity binds an ordinary note PUT/DELETE, note batch and history restore, and multitable batch, history restore and CSV import to the note ID in the URL; template PUT/DELETE bind to the matching template ID and type. Template creation and other unbound operations fail closed until their input is cryptographically bound to the source authorization. All bindings additionally require the original request's signed method/path and current account session.

The legacy ORM foreign keys use named placeholder columns on separate metadata, preserving the referenced table and column names and the already-migrated physical schema. The independent Thought schema continues to omit external FK constraints; a new-process test actually writes a document without importing the foreign models or database factory.

## Alternatives considered

- Updating Assets after a source commit without preparing first allows deletion of a file before its pin exists.
- Aborting after a timeout can release the only retained reference to an already committed source mutation.
- Loading Identity and Assets ORM just to resolve foreign key metadata breaks the independent process boundary.
- Treating a general service credential as proof of a specific source resource allows one authorized request to affect an unrelated document.

## Consequences

The source outbox can replay a previously accepted remote intent and finalize a known durable outcome without resubmitting business writes. Source commit ambiguity remains pending until restart recovery examines the persisted source outcome; pending intents are not discarded by age.

Note batch and history restore, and multitable batches, history restore and CSV import now prepare pins before source writes and record the outcome with the mutation; note batches also commit their idempotency receipt in that transaction. A dedicated HTTP adapter exists for these operations. The independent HTTP adapter also exposes note restore, knowledge-base trash/restore and directory moves using the existing account-scoped CAS and publication-withdrawal rules; these operations do not release retained assets. These are tested application boundaries, not a completed Thought deployment: an incomplete independent HTTP application now assembles these adapters and the process-locked delivery worker, but its readiness probe stays at 503 until the remaining interfaces and migration are complete. Archive/import, automatic upload recovery and community writes each still need complete integration before service cutover. Template application and ordinary document creation prepare initial document references as described in [the application decision](2026-11-03-thought-template-apply-retention.md) and [the creation decision](2026-11-03-thought-note-creation-retention.md). New template creation prepares its own initial asset projection as described in [the creation decision](2026-11-03-thought-template-create-retention.md). The incomplete independent upload HTTP adapter is described in [the upload retry decision](2026-11-03-thought-upload-idempotent-http.md). Existing resources also require a controlled initial reference projection; absent projections fail closed. Community source-account authorization cannot reuse the same-owner note method. Existing recovery application behavior and public API remain unchanged.

## Verification

Isolated database tests exercise source transaction rollback, prepare reply loss with restart, remote commit reply loss and idempotent settlement, saved-note source commit reply loss, concurrent revision conflict and abort, cross-account denial, and template update/delete pins. A real Identity, Thought and Assets HTTP scenario checks a note batch, its operation replay and final delivery with an isolated initial reference projection. A real Identity plus Assets ASGI scenario also checks same-resource ID/type, source path/method, cross-account session denial and settlement after logout. Fresh-process Thought writes and existing recovery site document/template tests run without real persistent data or providers.

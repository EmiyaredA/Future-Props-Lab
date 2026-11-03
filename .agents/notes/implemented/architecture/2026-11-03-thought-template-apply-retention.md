# Agent Note: Retain assets when applying Thought templates

Status: implemented

## Problem

Applying a template creates a document whose content and table records can reference library files. A separate Assets service must retain these references before the document is committed, even if the template changes during the operation or the commit result becomes uncertain.

## Decision

The independent Thought template application validates the current template revision and account-owned file metadata, allocates a new document UUID, and prepares the union of document and multitable file references at initial revision -1. Identity grants this narrowly scoped note creation authority only for the original template-apply request, a UUIDv4 target and initial revision. Thought then revalidates the template revision, reserves the knowledge base revision, creates the document, table state and history, and records the retention outcome in one source transaction. A known rollback aborts the prepared intent; an uncertain commit is left for recovery.

## Alternatives considered

- Pinning files after document creation leaves a window in which a referenced file may be deleted.
- Trusting a template snapshot without rechecking its revision can create a document with assets different from those prepared.
- Allowing template application to update an existing document projection would widen the authority of a creation request.

## Consequences

Newly applied templates receive an initial document projection. Existing documents and templates still require independently verified historical projection and data transfer. Archive/import, community writes, service deployment and readiness remain incomplete; this change does not migrate production data. The existing recovery application retains its prior transaction behavior.

## Verification

Isolated real Identity, Thought and Assets HTTP scenarios cover image and multitable attachment pins, cross-account rejection, version conflicts and unchanged public contracts. An injected concurrent template update confirms the prepared intent is aborted without creating a document; a lost commit acknowledgement preserves and delivers the committed result. Identity tests reject other kinds, revisions and malformed target IDs.

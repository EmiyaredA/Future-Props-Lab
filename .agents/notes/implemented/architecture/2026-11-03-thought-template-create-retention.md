# Agent Note: Retain assets when creating Thought templates

Status: implemented

## Problem

Creating a template can reference account-owned files. A separate Assets service must protect those files before the template is committed, and an uncertain source transaction must not be treated as a rollback.

## Decision

The independent Thought template creation endpoint validates the template and its account-owned assets, assigns a new UUID, and prepares the exact initial asset set at resource revision -1. Identity allows this authority only for the original template creation request, template resources with UUIDv4 identities, and initial revision -1. Assets still verifies the actor and file ownership. Thought validates again after preparation and commits the new template and its retention outcome together; only a known rollback aborts the prepared reference. The existing delivery worker settles durable outcomes. The public request and response contract remains unchanged.

## Alternatives considered

- Creating a template first and pinning its assets later exposes a deletion race.
- Letting the creation request authorize arbitrary resource revisions or kinds would permit it to modify unrelated existing projections.
- Aborting an intent after an ambiguous commit could release files referenced by a committed template.

## Consequences

New templates made through the incomplete independent Thought application have an initial projection. Existing templates still need a separately verified historical projection before their independent updates can proceed. Template application is covered by [a separate decision](2026-11-03-thought-template-apply-retention.md); data transfer, service deployment and readiness remain separate work; no production data is migrated here. The legacy application keeps its existing transaction behavior.

## Verification

Isolated tests cover initial commit, source failure and abort, permission scope and rejection of other resource kinds, revisions and malformed IDs. A real Identity, Thought and Assets HTTP scenario verifies same-account file retention and cross-account denial. The independent operation is checked against the existing public OpenAPI contract.

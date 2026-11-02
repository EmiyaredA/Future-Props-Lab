# Agent Note: Independently assembled model catalogue HTTP cases

Status: implemented

## Problem

Catalogue HTTP handlers construct legacy settings and task-occupancy adapters directly. A service cannot reuse the existing endpoint contract without importing the old database's governance and workshop dependencies. The catalogue module also imports provider diagnostics even for catalogue-only requests.

## Decision

Provide immutable per-app catalogue bindings for default selection storage and task occupancy. Pure HTTP dependencies construct account-bound catalogue and supplier cases from those bindings. The recovery website installs its legacy adapters at assembly; independent Models supplies owned adapters. Keep provider diagnostics in a separate owning route module, and extract shared model error translation out of the inference router.

## Alternatives considered

- Copying the entire router leaves two public contracts and business flows to maintain.
- Selecting legacy adapters as silent defaults hides incomplete service assembly.
- Importing inference routes for a small error mapper loads unrelated execution infrastructure.

## Verification

The fresh-process catalogue slice runs with an absent config and empty encryption key, loading neither account ORM, legacy sessions nor workshops. Guarded Models tables and signed actors exercise catalogue writes, supplied defaults, CAS conflict snapshots, cross-account refusal, missing-binding rejection and canonical operation IDs. Local model/diagnostic/website regressions pass, and the full backend suite passes 2002 tests with four conditional skips. Public contract/SDK, Python lint/format and note checks pass. The slice is an isolated test assembly, not a production Models startup.

## Consequences

Per-app catalogue dependencies are immutable and account binding precedes case construction. The legacy website supplies its own adapters explicitly; business routes do not choose a fallback database. Diagnostics and shared error mapping can evolve without loading execution infrastructure during catalogue-only assembly.

## Risks

Catalogue isolation is only part of Models. Diagnostics, provider/demo transport, local capabilities, task execution, quotas, assets and native workers still require their own complete service bindings before production cutover.

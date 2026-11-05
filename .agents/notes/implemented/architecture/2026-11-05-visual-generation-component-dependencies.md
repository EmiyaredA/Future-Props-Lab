# Agent Note: Visual generation component dependencies

Status: implemented

## Problem

Models visual generation components accepted an application state container. Results obtained their
output path through the runner, while the runner and retention borrowed file methods from intake.
Replacing one lifecycle component therefore required preserving unrelated internal methods.

## Decision

VisualGenerationFiles owns local staging, output and input path validation. Batch identity/digest
lookup is a storage function shared by intake and results. Intake, runner, results and retention
receive only their sessions, files, authorization, client and configuration dependencies. Preflight
receives its original-file client and upload URL explicitly.

The local file adapter rejects directory-changing identifiers and symlinked roots, accounts, staging
batches and files. Components can reopen the same persisted files without constructing a runner or
an intake instance. Existing private records, source assertions and the GenerationTaskDriver state
rules remain unchanged.

## Alternatives considered

- Keeping state with fewer documented attributes would retain runtime service discovery.
- Adding forwarding methods on the runner/intake would preserve lifecycle coupling.
- Copying file layout logic into results would create multiple sources of storage truth.

## Consequences

Assembly constructs the shared file adapter and supplies each capability explicitly. Results no
longer require an execution lifecycle to read or acknowledge files. This batch removes peer lookup
and file-layout coupling; deeper transaction/use-case decomposition remains separate work.

## Verification

111 targeted generation, execution-authority and architecture regressions pass before additional
file-boundary coverage. File tests cover component recreation, account isolation, invalid segments
and symlink rejection. The Visual cross-service protocol is rerun with the explicit constructors.
OpenAPI, ownership metadata and all service source-closure entries are checked independently.

## Assembly follow-up

Models constructs the visual intake, runner, and result reader only when the
Visual peer key is configured. Other Models deployments can provide the
ordinary capabilities port without exposing an HTTP client for visual originals.
The targeted Models, Visual, Integration and Annotation regressions passed
37 tests, including the no-peer Models assembly and owner-scoped original import.

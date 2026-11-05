# Agent Note: Thought sync explicit ports

Status: implemented

## Problem

Thought sync submission accepted an HTTP Request, reconciliation accepted an application state
container, and image staging discovered its reader through Session metadata. These hidden inputs
made replacement depend on protocol and database internals. A cancelled compatibility copy could
also leave its worker writing after the caller began deleting temporary files.

## Decision

Protocol adapters extract source assertion, method and path and supply explicit asset, staging,
authorization and execution ports. Submission and reconciliation receive those arguments directly.
SyncArtifacts consumes the authorized AssetMetadata interface, and the compatibility runner receives
its metadata factory from website assembly. Neither staging nor the runner discovers that service
from Session information. Other Thought Session bindings remain for later migration.

runtime/tasks/blocking_io.py holds a completion barrier for blocking I/O. Repeated cancellation waits
for the worker to finish before propagating cancellation, consuming late errors. The caller can then
safely release borrowed files. Adapters remain responsible for bounded work; this mechanism cannot
interrupt arbitrary blocking operations.

## Alternatives considered

- Passing a smaller state container would still hide the required capabilities.
- Keeping optional Session lookups would mask missing assembly.
- Immediately abandoning a copy on cancellation would race temporary directory cleanup.

## Consequences

Sync retains existing atomic work/manifest commits, receipt checks and unknown-result recovery.
Unknown commits retain staging; uncommitted preparation cleans it up. Reconciliation never retries an
unverified external action. Public HTTP, grants and stored task formats remain unchanged.

## Verification

138 initial sync, account, asset and architecture cases pass. Additional regression checks both SQLite
and memory readers against the same snapshot behavior, validates digest tampering and partial cleanup,
and exercises repeated cancellation with successful and failing workers. Local protocol stubs verify
remote unknown-result handling without live supplier credentials.

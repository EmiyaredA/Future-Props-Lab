# Agent Note: Workbench shared turn records

Status: implemented

## Problem

The website retained separate copies of conversation queries, approvals, answer updates, turn
endings and startup recovery after the independent Workbench adopted shared records. Fixes to
one path could leave different cancellation, approval limits or recovery behavior in the other.

## Decision

Both entries consume account queries and recovery from `execution/transcripts.py` and atomic
answer, approval and ending operations from `execution/turn_records.py`. Website operations first
verify the live project and identity, then invoke the same approval transition within that write
transaction. Consumers import their owning component directly; there are no forwarding shims.

Cancellation and non-successful completion pause the conversation in the same transaction. Website
startup uses the shared account enumeration and per-owner recovery. The website adapter retains
operations that require local project authorization, rather than copying common storage behavior.

## Alternatives considered

- Keeping both implementations with parity tests still requires every state fix to be duplicated.
- Re-exporting the shared functions from the website module preserves misleading dependencies.
- Moving website project checks into shared records would load host and account implementation
  dependencies into the independent service.

## Consequences

The website storage module loses over 250 lines of duplicate implementation. Shared functions are
still SQL adapters; this change does not claim that all queue and approval use cases have acquired
replaceable ports. Public routes, response models, source permissions and persistent formats remain.

## Verification

- Existing website and independent execution tests cover approval, cancellation, queue recovery,
  activity and source reading using isolated databases and controlled executors.
- Architecture checks prevent these common operations from returning as website-local definitions.
- OpenAPI, service ownership and all 23 source-closure entries remain checked.

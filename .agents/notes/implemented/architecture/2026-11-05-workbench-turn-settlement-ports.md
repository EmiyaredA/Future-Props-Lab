# Agent Note: Workbench turn settlement ports

Status: implemented

## Problem

Native turn settlement checked the lease in a separate read transaction before writing the receipt
and turn. State decisions, SQL and HTTP errors were mixed. A successful receipt replay returned
before cleaning ephemeral instruction handles. Local and native endings duplicated cancellation
priority and could not be tested without database infrastructure.

## Decision

`SettleTurn` creates a detached immutable receipt command. Its storage port commits the receipt,
turn ending, pending-action resolution and queue pause in one short transaction. `SqlTurnSettlement`
checks owner, worker, lease and exact payload against the locked snapshot; the shared decision
rejects conflicting evidence and accepts an identical replay. HTTP maps domain failures.

Expiry forbids new actions but permits reconciliation of the same attempt. An already interrupted
or cancelled turn remains terminal even if the job later receives a completed receipt. Unknown
results never trigger another execution. Both local and native execution use `turn_endings` for
cancellation priority and unresolved approvals, instructions and activities. Receipt replay also
releases ephemeral handles after storage confirms success.

## Alternatives considered

- Keeping the preliminary lease query leaves a gap between validation and atomic settlement.
- Rejecting all expired receipts loses reconciliation evidence after worker disconnection.
- Replacing interrupted state with late success would silently resume a paused conversation.

## Consequences

The native HTTP envelope, checksums, table layout and migration history remain compatible. A commit
acknowledgement failure may retry the exact receipt, never the external action. This batch does not
yet extract the remaining submission, approval and queue interfaces.

## Verification

- The same memory/SQLite cases cover expired-attempt reconciliation, account/worker/lease/payload
  isolation, duplicate and competing receipts, rollback, lost commit acknowledgement, cancellation
  and terminal recovery. Pure tests verify unresolved actions become unknown without input mutation.
- Workbench and cloud-control regressions exercise both entries, with isolated data and controlled
  executors. Studio dependency checks and all service source-closure entry imports are included.

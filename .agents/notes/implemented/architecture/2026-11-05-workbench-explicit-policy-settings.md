# Agent Note: Workbench explicit policy settings

Status: implemented

## Problem

Workbench project binding, execution transactions and source reading obtained cloud settings from
global configuration. A supplied application instance could not select that dependency explicitly,
and testing policy changes depended on process-wide lookup behavior.

## Decision

Website assembly supplies the configuration reader to HTTP operations and the lifecycle-owned
Workbench runner. Project authorization, write-lock rechecks and post-read rechecks load a current
snapshot through this explicit dependency. Project registration, directory validation and label
resolution require a supplied snapshot and have no global fallback.

Identity's existing authorization adapter accepts the same explicit snapshot for enabled checks.
Its legacy fallback remains for callers outside this batch; Workbench always supplies the snapshot.
Fixed runtime paths still come from startup settings, separately from refreshable authorization.

## Alternatives considered

- Injecting only the startup snapshot would stop live revocation and configuration updates.
- Putting the reader in Session metadata would hide the dependency inside a storage object.
- Letting each function construct configuration would retain process-global coupling.

## Consequences

Workbench no longer imports global settings getters. Two independent assemblies can provide their
own policy source; each operation still checks live policy at its existing security boundaries.
CLI connection resolution and other applications' legacy settings lookups remain separate work.

## Verification

- Workbench/cloud-control regressions cover local and public access, revocation, approvals, queues,
  source reading and configuration application without restart using isolated fixtures.
- An architecture gate rejects global configuration lookup in Workbench implementation.
- OpenAPI, ownership metadata and all 23 service source-closure imports remain checked.

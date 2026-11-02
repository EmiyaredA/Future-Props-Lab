# Agent Note: Preserve sibling services during failure observation

Status: implemented

## Problem

The initial management supervisor stopped healthy business containers after one member exited or failed to start. Replacing Portal could therefore interrupt Agents and other applications, contradicting the approved independent-service lifecycle.

## Decision

Host supervision observes and reports lifecycle state without issuing stop or restart commands. Exited, missing and unhealthy members leave siblings running; observed recovery clears the failure. Only an explicit authorized action changes the configured group lifecycle. Graceful stop and force-stop remain separate operations.

This supersedes the automatic group-cleanup sentence in [Independent management service](../architecture/2026-11-02-independent-management-service.md). Compose execution also explicitly disables dotenv and rejects a selected Compose symlink before resolving its path.

## Alternatives considered

- Cleaning up every remaining container makes a service update interrupt unrelated tasks.
- Automatically restarting failed members could repeat work with an unknown execution outcome.

## Consequences

A partial deployment remains visibly incomplete while working applications continue. Administrators must explicitly resolve failed members or stop the group; observation cannot serve as hidden authorization for lifecycle changes.

## Verification

Twenty-one focused management and host checks pass, including exited/missing/unhealthy members, sibling survival, recovery, partial startup, graceful timeout and explicit force-stop. The isolated Management container separately passes session, governance, receipt and restart acceptance; that test does not claim real Models or full native deployment integration.

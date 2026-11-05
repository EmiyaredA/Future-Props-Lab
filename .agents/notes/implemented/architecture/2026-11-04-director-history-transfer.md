# Agent Note: Transfer Director project records and original files

Status: implemented

## Problem

Director owns project documents, revisioned state and motion records. Legacy files sit under account directories and their content hashes appear in project and motion data. Copying records without verifying those references would create unrecoverable projects.

## Decision

The loopback maintenance process pages owned projects and motions independently. Record writes and receipts commit together. File maintenance streams uploads under a bounded size, verifies the SHA256 key, publishes durably without replacing an existing object and records its receipt. Retried files must match the published bytes. The relay compares both manifests and verifies every referenced file before reporting success.

## Alternatives considered

- Moving the entire legacy account directory would include content owned by other services.
- Buffering binary files in JSON would exceed the normal upload memory budget.

## Consequences

Unknown accounts, project IDs, paths, missing references, changed bytes and pending project deletion directories prevent promotion. Records above the 32 MiB maintenance request limit require a larger-record transfer path. The old-site snapshot retains transient deletion and staging directories for recovery.

## Verification

The isolated compatibility website creates a project, saves a revision with an external resource, and publishes a user motion. Its sealed snapshot is transferred through real loopback listeners. The run rejects a corrupt file and an unassigned account directory, checks replay and reads the original files and revision from the restored compatibility site.

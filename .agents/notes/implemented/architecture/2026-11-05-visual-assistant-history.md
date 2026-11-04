# Agent Note: Preserve Visual assistant history and attachment ownership

Status: implemented

## Problem

The Visual project migration must carry conversation, transcript and tool history into the standalone service. Attachment IDs need retained originals in Assets under the same account and project scope.

## Decision

The Visual maintenance transport pages conversation, message, attachment and action records in dependency order. It resolves descendants through the owned conversation and project, checks that action generation references point into the same project, and checks structured message attachment parts against saved links. After Visual imports, the driver relays one conversation projection per source conversation. Assets requires the owned Canvas projection and a verified original-file receipt for every attachment before accepting the scoped pins. Live conversation attachment reads and project deletion honor the same project association.

## Alternatives considered

An aggregate transcript archive could exceed the bounded maintenance request size and lose granular restart points. Restoring message rows without Assets retention would allow an original to disappear while still referenced by a migrated transcript.

## Consequences

Historical messages, tool outcomes, attachment positions, approval group IDs and referenced generation task IDs keep their original values. Accounts cannot claim another project's conversation projection. Empty conversations also receive projections so their existing delete operation can settle.

## Verification

The Visual rollback rehearsal imports an isolated conversation with two messages, a structured attachment and an external tool action linked to a migrated generation task. It tests pin import before the Canvas projection, confirms repeated import returns the same result and compares the restored Assets pin scope. The recovered legacy website serves the same attachment and action.

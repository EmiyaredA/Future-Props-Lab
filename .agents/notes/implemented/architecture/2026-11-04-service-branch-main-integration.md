# Agent Note: Integrate main with the independent service branch

Status: implemented

## Problem

The service branch and main both changed startup, previews and website navigation. Taking either version wholesale loses service-owned adapters or restores retired host tools. The independent workbench also needs the same account access rules as the compatibility site.

## Decision

Keep the current website launcher as the default while the cutover gates are open. Independent Compose and LaunchAgent commands use explicit names. Keep rendering and other service adapters at their ownership boundaries. Use Portal to serve the Cloud Control entry and Agents to serve the workbench. Identity applies the Cloud Control permission to gateway authorization and live rechecks. Agents applies it to direct service requests and background collection.

## Alternatives considered

- Making the Compose launcher the default during integration would expose an incomplete deployment to existing startup commands.
- Enforcing Cloud Control permissions only in the browser would leave direct service and background access available to ordinary accounts.

## Consequences

Both launch paths are available for isolated verification. Existing ordinary-account workbench data stays under its original ownership. The branch can proceed to service completion and migration rehearsal before the formal startup switch.

## Verification

The [cutover checklist](../../../../docs/operations/independent-services.md#同条件性能对照) also gates the release on a matched monolith and candidate latency comparison. Functional smoke tests do not measure the cost of additional authorization or service hops. Capture raw samples on equivalent isolated data so a detected regression can be attributed and rechecked.

The service catalog is generated from the merged public contract. The isolated Agents scenario exercises an ordinary-account denial and the existing administrator collection and read paths.

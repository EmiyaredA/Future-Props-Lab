# Agent Note: Route CLI connections through the owning Agent Runtime and Mac worker

Status: implemented

## Problem

The three shared CLI connection operations inspect host executables and can update the local deployment settings. Their independent HTTP service must preserve the public contract without importing personal CLI state or mounting the host configuration.

## Decision

The compatibility site and Agent Runtime use the same HTTP router and response shapes. Agent Runtime validates the Identity assertion and stores the connection job in its SQLite database. The dedicated loopback native lane sends a closed operation and a typed payload to the worker. It does not send the browser credential or a path chosen by the caller.

The Mac worker checks the job lease and account before invoking a fixed probe. CLI enablement checks the live account again before publishing the revision-checked TOML update. The worker persists the result before acknowledging it and can resubmit the original receipt. Catalog responses hide executable paths outside the local administrator lane.

## Alternatives considered

- Mounting the Mac executable tree in the container would widen the service's access and fail to preserve the host CLI environment.
- Reusing browser cookies for worker authorization would disclose credentials to the host protocol.
- Reissuing an unconfirmed enable operation would lose the distinction between a known failure and an unknown config write.

## Consequences

The independent browser release serves the published CLI connection page. The Mac worker reads and changes the code-agent section of the configured deployment TOML through the existing revision-checked writer. The installed service owns only its connection jobs and credentials. Workbench project execution and Amadeus task execution still require separate scoped commands and deployment acceptance.

## Verification

The focused tests use Identity's signed claims and the worker protocol to cover local authorization, public path masking, late revocation and lost acknowledgement with one execution.

Three installed containers and a real Mac worker transport verify browser password reauthentication, CLI enablement, model discovery and responsive redetection using a synthetic executable and isolated TOML. The public listener requires login.

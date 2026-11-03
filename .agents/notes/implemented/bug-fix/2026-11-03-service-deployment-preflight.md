# Agent Note: Preflight every selected service database

Status: implemented

## Problem

The management launcher checked only Identity, Management and Models before issuing Compose commands. Other selected services could have a missing, foreign or outdated database; their own startup guard would reject it only after deployment had already changed container state. `--check` could also report a deployment ready despite an invalid selected business database.

## Decision

The host preflight checks each explicitly configured service in the selected business set, together with the governance databases needed by the chosen launch mode, using the service's registered migration sequence and the existing read-only validation. Unknown configured services and missing state paths fail before any Compose action. Management-only mode checks its governance dependencies without requiring stopped business services. Preflight never applies migrations or creates a database.

## Alternatives considered

- Rely only on each container's startup checks: the error appears after deployment has already begun.
- Apply missing migrations during startup: this changes persistent schema without an approved, tested migration step.
- Check every catalog entry: undeployed services should not block a management-only launch.

## Consequences

A configured business deployment fails early for migration drift and ownership errors; independent service guards remain responsible for rechecking on actual start. Newly deployable services must register their migration sequence in this explicit host preflight.

## Verification

Tests cover all selected services, management-only selection, unknown service and missing state rejection, and an actual isolated database with a valid but outdated migration prefix; preflight rejects it without changing database bytes.

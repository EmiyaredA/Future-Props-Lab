# Agent Note: Inject native Models readiness and cleanup policy

Status: implemented

## Problem

Models discovers native readiness from the SQL session's metadata and
infers cleanup requirements from the deployment identifier stored there.

## Decision

The independent assembly supplies its broker as the readiness port to
catalog, inference admission and synthesis. It declares the native result
cleanup requirement explicitly. The website uses local readiness checks.

## Alternatives considered

Using the database service identifier to select a default would require
storage callers to recreate hidden deployment context.

## Consequences

The same broker checks admission and execution on the independent service.
Unknown task outcomes and the order of result retirement remain protected
by the existing inference lifecycle.

## Verification

Local model, inference, native worker and retention regressions exercise
the configured paths. The architecture check rejects the former readiness
session key.

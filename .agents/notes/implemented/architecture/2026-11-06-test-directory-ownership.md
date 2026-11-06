# Agent Note: Group tests by ownership

Status: implemented

## Problem

Flat test roots hide the app or subsystem responsible for a test.
Moving a test also changes fixture imports and paths derived from its
source file.

## Decision

Python tests live under their application or under architecture,
contracts, runtime, host or integration. Web tests live under features,
shared or platform. Shared fixtures retain their established locations.
Tests linked by protected product documentation retain their paths.

## Alternatives considered

Replacing the old evidence with forwarding test files would create two
discovery paths and make ownership ambiguous.

## Consequences

Test discovery keeps one module for each scenario. Script, npm, and
documentation references use the new locations where applicable.

## Verification

Pytest discovery, architecture gates and the Web suite exercise the
relocated modules. Document validation checks the preserved evidence.

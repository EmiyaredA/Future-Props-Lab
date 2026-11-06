# Agent Note: Move CLI execution and connections into Studio

Status: implemented

## Problem

The last legacy backend package mixed native process handling, account
access, public connection data, and two service entry points.

## Decision

Host owns CLI process, tool, credential and connection configuration
adapters. Agent Runtime owns the public connection routes and contracts.
The website authorizes connection use through Identity, and the independent
service keeps its leased connection operations.

## Alternatives considered

Keeping compatibility imports would leave both package roots in the wheel
and permit future callers to bypass the new ownership boundaries.

## Consequences

Application code and service builds resolve Studio module names directly.
Public routes, the private CLI configuration format, and the existing
leased worker protocol retain their contracts.

## Verification

CLI protocol and account tests, independent Agent Runtime, the OpenAPI
comparison, and service source closure checks cover the new boundaries.

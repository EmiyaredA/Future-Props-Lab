# Agent Note: Inject Video layout and media ports

Status: implemented

## Problem

Video project layout mutations and timeline reads looked up adapters in
SQL session metadata. Approved assistant edits and Motion handoff also
relied on the website's default session configuration.

## Decision

Project creation and removal receive their layout adapter at the call
site. Timeline writes, clip merges, and segment exports receive the
authorized media adapter. Website assembly supplies the same account
scope and adapters to assistant edits and Motion handoff.

## Alternatives considered

Storing adapters on every session would retain hidden coupling for reads,
writes and work that uses its own transaction.

## Consequences

Read paths need no mutation adapters. Revision checks, idempotency,
cross-service authorization, and commit recovery stay in their existing
operation boundaries.

## Verification

Video, Motion handoff, and Amadeus regression tests exercise both
assemblies. The architecture check guards the former session keys.

# Agent Note: Resolve Visual acceptance schemes from executor owners

Status: implemented

## Problem

The published Visual acceptance catalog must report the actual fixed model and Mac CLI connection status. Visual cannot read the Models database or inspect host executables in its container.

## Decision

The fixed vision model selection belongs to Models. The account and model configuration fields are assigned to that service and its private response contains only a model label, slug and provider label. Agent Runtime accepts a read-only native lease for the fixed Visual acceptance operation. The Mac worker resolves and probes the five registered connections using the existing host configuration, and returns availability and static messages. Identity issues the two grants only for matching acceptance operations and revalidates the original account at lease admission.

## Alternatives considered

Sharing the old configuration and database with the Visual container would bypass both owners. Returning a static catalog would hide actual CLI readiness and could expose a fixed model to the wrong account.

## Consequences

The existing public six-scheme response and operation ID stay compatible. If the Mac worker is unavailable, CLI schemes show the worker status and the configured Models scheme remains usable for discovery. Neither private projection transfers executable paths or provider credentials.

## Verification

The signed catalog test drives the native worker and checks that an unrelated discovery request cannot obtain either grant. The six-service Compose exercise uses a local synthetic executable with the real Mac worker, verifies the fixed Models configuration, and repeats the query after restarting Visual and Agent Runtime.

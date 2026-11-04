# Agent Note: Galgame video render preflight

Status: implemented

## Problem

The published Galgame video preflight used the compatibility process to inspect originals and renderer capacity. The independent Galgame service has neither the Assets filesystem nor Rendering's executable environment.

## Decision

Share the route planner and existing preview fingerprint construction. Galgame obtains exact Story asset facts from Assets and obtains the current ffmpeg, font and work volume checks from Rendering through an exact project and source-operation grant. The public result contains the original blocker and route fields. Rendering packages the two existing licensed dialogue fonts.

## Alternatives considered

Checking the Galgame container for ffmpeg and fonts would report the wrong execution environment. Copying media originals into Galgame just to compute the plan would duplicate I/O and widen storage access.

## Consequences

The original preview route uses the same fingerprint inputs and can distinguish stale Story revisions, missing files and unavailable renderer dependencies. Capacity details used internally are reduced to the existing public blocker fields.

## Verification

Directed tests cover retained files, repeated fingerprints, stale Story and renderer dependency, font and capacity failures. The isolated Compose test checks the real Rendering binaries and fonts through the Gateway, then checks the saved Story and preview after restart.

# Agent Note: Render exact Galgame frames in Rendering

Status: implemented

## Problem

Exact Galgame frames require route timing, dialogue and lip sync while the independent app owns no original media and the renderer owns no Story database.

## Decision

Keep route validation in Galgame and put deterministic compilation in the shared media capability. Galgame sends a digest-bound Story and resolved route. The renderer verifies its separate Assets grant belongs to the same actor, then reads only the current Story's exact file revisions. It compiles using the same functions as the compatibility site and rechecks live authorization before returning the PNG.

## Alternatives considered

Mounting Galgame or Assets data into Rendering would bypass ownership and couple deployment to storage paths. Compiling with placeholder media would change the selected frame's lip sync and skin rendering.

## Consequences

The existing frame operation still returns an exact PNG using the published time and crop rules. Input staging belongs to Rendering. The same compiler version, durations and fonts are used by compatibility export, exact frames and Video Editor handoff.

## Verification

Eighty-six focused checks passed, including the existing legacy render suite, route contract and image ownership gate. The signed test checks a real PNG, repeated bytes and the out-of-range response. Isolated Compose with Chromium checks a 640 by 360 frame and the same SHA-256 after restart.

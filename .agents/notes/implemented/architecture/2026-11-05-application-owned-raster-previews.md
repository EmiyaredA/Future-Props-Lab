# Agent Note: Application-owned raster previews

Status: implemented

## Problem

Assets duplicated the raster decoder and its global semaphore. Models and Creative used another
global decoder, while Identity kept an additional module singleton. These hidden lifetimes coupled
independent applications and could release a decoding slot early after repeated cancellation.
Avatar file operations also selected process-global configuration.

## Decision

runtime/files/raster.py owns the single decoder, orientation handling, transparent WebP conversion
and atomic output. Application assembly constructs bounded RasterPreviews instances and passes them
to Models attachments/results, Creative covers, community files and avatars. Assets retains only its
owner/version cache path and domain error mapping. The Identity forwarding module is removed.

RasterPreviews uses the shared blocking I/O completion barrier. Cancellation waits until decoding
stops before releasing its slot, including repeated cancel requests. Avatar reads, writes, staging,
deletes and startup cleanup receive the current application's configuration explicitly.

## Alternatives considered

- A shared process singleton preserves hidden coupling between application lifetimes.
- Constructing a decoder for each request would bypass the intended concurrency bound.
- Keeping a second decoder in Assets allows validation and image behavior to drift.

## Consequences

Image variants, private cache policy, original files and versioned paths remain compatible. Public
interfaces keep existing error mapping. Tests constructing content readers explicitly provide the
preview capability, including account-isolation checks that fail before image decoding.

## Verification

Targeted regression covers actual image orientation/transparency, concurrent atomic outputs, avatar
and community authorization, revocation, Creative covers, Models assets and migration ownership.
A controlled worker test verifies application independence and that repeated cancellation cannot
release a slot before I/O completes. Architecture gates forbid duplicate decoders and global capacity.

# Galgame Annotation import preview through service contracts

Status: implemented

## Problem

Galgame needs to plan an Annotation import without reading Annotation's database or accepting an unrelated master audio file.

## Decision

Galgame delegates an owned snapshot read to Annotation and an original audio digest read to Assets. Identity binds both grants to the Galgame import route and its project. The preview compares the source digest and duration with the Galgame master and uses the same Story validation as the compatibility route.

## Alternatives considered

A shared database join would require Galgame to load Annotation state and Asset storage paths. Client-supplied digests would allow unrelated source bytes to pass validation.

## Consequences

The public preview keeps the published operation and response shape. Annotation owns document revisions, Assets owns original bytes, and Galgame owns the import plan and Story revision.

## Verification

The focused protocol and compatibility suite passed 81 tests. Six isolated Compose containers exercised the preview using a generated WAV, and Chromium verified the existing Galgame project and editor routes through Gateway.

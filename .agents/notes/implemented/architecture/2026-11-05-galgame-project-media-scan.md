# Agent Note: Galgame project media scan

Status: implemented

## Problem

The published Galgame metadata scan read local files in the compatibility site. In the split application, Galgame owns its classification and transcript, while Assets owns the original bytes.

## Decision

Use an exact project-bound grant for the scan. Assets computes SHA256 and inspects the owned original files. Galgame reads the result before opening a writer transaction, then updates only the technical metadata. TinyTag is pinned to the same version and hashes already used for the compatibility site and Annotation.

## Alternatives considered

Giving the Galgame container the Assets state directory would bypass ownership checks. Downloading the complete project merely to inspect it would duplicate large I/O and increase memory use.

## Consequences

The scan keeps the published list response and existing transcript revisions. Existing unreadable files retain prior technical metadata, and unknown audio or video tags still allow digest verification.

## Verification

Signed endpoint tests scan a real WAV and verify its exact digest, duration, and manually entered transcript. Compatibility Galgame and packaging tests verify the shared inspection code and service boundary.

# Agent Note: Export Galgame portable snapshots from owner services

Status: implemented

## Problem

A Galgame archive needs the saved Story, project settings and the exact referenced original files. The independent app has no access to the Assets file tree or Models catalog database.

## Decision

Reuse the published ZIP writer and Galgame asset record format. Galgame selects its project originals and current Story references, excluding unrelated render outputs. Assets streams only the requested file revisions in the project's scope under a digest-bound grant. Models returns the owning account's portable provider kind and model slug. Galgame checks current authorization before returning the archive.

## Alternatives considered

Mounting the shared Assets tree would bypass file scope and retention. Persisting a deployment model ID in the portable archive would prevent imports into another catalog.

## Consequences

The published download stays compatible with the existing Galgame snapshot reader. Changes to an original during export return an error instead of producing an incomplete archive. Large files are transferred and written in bounded chunks under the service's own scratch directory.

## Verification

Focused checks passed with 71 tests. The signed Models test confirms a foreign catalog ID produces no model reference. Six isolated containers and Chromium exercised the published route with generated M4A clips and a WAV master. The archive's file set and per-file SHA-256 matched its manifest.

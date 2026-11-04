# Agent Note: Bind Creative catalog files to owned service storage

Status: implemented

## Problem

The independent Creative session scopes catalog writes, but cover and Skill operations still resolve paths through the compatibility site's runtime settings. An independent catalog must keep bytes and database references under the same service root.

## Decision

Bind immutable file settings and an owned Skill staging adapter in the Creative database factory. Catalog reads, writes, and rollback cleanup use the same scope. The archive validator accepts an explicit staging root and archive limits while Integration installation and deletion keep their existing storage adapter. Compatibility callers continue to use the existing account path format. The public catalog explicitly reloads the committed row after publishing rather than reading an expired asynchronous ORM instance.

## Alternatives considered

- Changing process-wide configuration to redirect Creative would make file ownership implicit and complicate isolated applications and tests.
- Duplicating the archive parser would create divergent validation for uploaded Skill files.

## Consequences

Creative can stage, read, publish, and clean up owned catalog files without opening compatibility runtime settings. An independently configured database with no file binding fails closed. Author lookup, cross-service installation and production readiness remain separate assembly work.

## Verification

An isolated owned database creates a draft, uploads a cover and Skill archive, publishes the Skill, and verifies the bytes under Creative's state root. Compatibility tests retain their checks for stale writes and uncertain commit cleanup.

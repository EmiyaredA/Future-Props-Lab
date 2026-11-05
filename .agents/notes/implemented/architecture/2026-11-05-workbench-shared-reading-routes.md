# Agent Note: Workbench shared reading routes

Status: implemented

## Problem

Website and independent Workbench maintained duplicate source, conversation, search, history,
attachment and event handlers. Only dependency selection and website execution registration
differed, making future permission and protocol fixes prone to divergence. Source allocation and
native-follow verification also read global settings from business/storage code.

## Decision

Both assemblies construct `transport/service.py` with their explicit request dependency types. The website
additionally mounts its execution router under the same prefix and browser-session permission
dependencies. Its parent package is lightweight; duplicate handlers are removed.

The router factory avoids pulling website authentication assembly into the independent Agents
image. It also preserves each entry's existing session dependency cache and account binding.

Each assembly supplies an explicit deployment-policy callback. Source creation and every native
follow validation receive the current enabled value, retaining their existing rejection behavior.
Independent assembly reads configuration once at construction and owns its lifecycle decisions.

## Alternatives considered

- Keeping copied handlers with shared helper functions would retain duplicate protocol ownership.
- Dropping browser-session dependencies during router merging could open account API-key access.
- Moving global lookup to another business helper would not make the policy dependency explicit.

## Consequences

Public paths, operation names and schemas remain stable. Website-specific execution still uses
its existing implementation. This batch does not merge the two execution coordinators or relax
source allocation, account isolation, native lease or runtime authorization checks.

## Verification

- Both website and independent Workbench regressions exercise source binding, history, source
  allocation conflicts, collector recovery, permission checks and session revocation.
- A disabled-policy route check proves no source is created. OpenAPI and deployment ownership
  stale checks verify the combined router retains the public contract.
- Final common-router regression: 88 passed. All 23 service source closures load independently;
  the factory preserves the existing website and independent authentication boundaries.

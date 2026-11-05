# Agent Note: Model call attribution without account database access

Status: implemented

## Problem

Model execution and log query modules import a credential adapter that loads Identity ORM and the monolith session factory. Even type-only attribution then initializes unrelated persistence, preventing independent Models packaging and encouraging cross-service key reads.

## Decision

Keep the immutable credential snapshot and row restoration in a pure LLM module. Only legacy HTTP/socket credential resolution reads its original account database. Independent Identity signs bounded non-secret API Key name/prefix alongside the existing account and key ID; Models reads verified actors and persists that historical snapshot. Browser Sessions cannot carry API Key metadata. Revocation and ownership checks stay in Identity.

Provider package initialization no longer assembles all adapters. Consumers import concrete owners, so log reproduction's pure protocol selection does not transitively load the demo runtime's legacy database. The demo execution configuration port is still required before independent Models assembly.

## Alternatives considered

- Importing the legacy credential helper into Models keeps hidden account ORM/session dependencies.
- Reading account SQLite from Models violates independent data ownership.
- Omitting key display metadata loses existing call-log attribution behavior.

## Verification

Fresh-process import tests reject Identity ORM and monolith DB initialization for snapshots and log queries. Signed metadata round trips preserve key attribution; malformed or unbounded metadata and Session/key mixtures fail closed. Identity's real HTTP use cases create/revoke a disposable key and authorize Models requests without loading Models ORM. API Key tests use a separate cookie-free client: an existing browser Session deliberately takes precedence over a bearer header. Thirty-six service boundary regressions pass, including signed requests, key revocation, delegation, retention and media source authorization. Inference, playground, realtime and log behavior retains its existing deterministic coverage.

## Consequences

Pure call attribution is separate from authentication and cannot read another service's database. Package imports select concrete provider owners instead of assembling every adapter. New internal assertion fields are optional for compatibility with existing signed requests; their presence never widens scopes or host authority.

## Risks

Metadata is historical display information and never grants permissions. The legacy adapter remains needed by the recovery website; independent Models must select the verified-actor adapter explicitly. This preparation alone does not complete Models assembly or allow production cutover.

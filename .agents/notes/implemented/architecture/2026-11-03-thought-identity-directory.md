# Agent Note: Thought uses a request-bound Identity directory

Status: implemented

## Problem

Thought histories, publication authors, article members and person fields query the Identity User ORM inside workshop transactions. A separately owned Thought database cannot execute those joins. Replacing the queries with HTTP without moving preflight checks would hold SQLite write locks during network waits; recreating plain community sessions also discards the service storage guard.

## Decision

Thought consumes an explicit account-directory port containing only account ID, username, display name and active state. Recovery assembly installs a local adapter, and direct storage tests explicitly opt into that adapter. Feature code never imports Identity ORM as a fallback. Dedicated Thought request dependencies install the port and prefetch the current actor and author name; browser-only community authentication keeps its separate dependency.

Identity exposes a private, digest-bound directory request for Thought-owned source operations. The caller must supply the Thought credential and a matching original request assertion; Identity rechecks the original account and Session or API Key before issuing a destination token. The private endpoint rechecks the actor and only returns the requested public account values. Passwords, email, credentials, sessions and other private settings are absent. Caller role and revision are a separate internal snapshot, valid for at most five seconds and never silently refreshed from inside a writer.

Publication membership usernames are resolved together before BEGIN IMMEDIATE. The transaction repeats source-management and article checks, applies the pre-resolved IDs and retains existing CAS behavior. Community table operations finish person validation before taking the writer lock, then repeat the article and introduced-reference checks inside that transaction. Historical author names continue to be copied into snapshots rather than dynamically rewritten.

Both community document and table sessions preserve the owning session classes, storage ownership metadata and explicit ports. Registry sessions permit only system reads before publication verification and source binding. They do not gain foreign-model access or unbound account writes. Local adapter lookups stay in the owning local transaction, while the independent adapter uses request-local public-value caches.

## Alternatives considered

- Keeping User ORM in Thought requires another service's schema or a copy of its account database.
- A broad service directory credential could enumerate private account data or bypass request authorization.
- Fetching a member or author after reserving a document revision holds a writer during HTTP.
- Reusing one global account cache lets revoked or changed roles authorize unrelated future requests.

## Consequences

Thought can create and edit empty-asset documents and publish, authorize and edit community articles against its own schema without a Users table. The account-directory boundary does not complete the asset, archive or integration protocols, and Thought remains gated from deployment until those independent capabilities are complete. Public API paths, browser-only community access, account ownership and author display behavior stay compatible.

## Verification

A fresh-process scenario uses real Identity login and delegation plus an independent Thought database. It covers document history authors, publication authors, username grants, permission updates, member edits, community person fields, exact query digests, minimal fields, browser/private-route rejection and logout revocation. SQL transaction events assert that no Identity request occurs while Thought holds a write transaction. Additional tests cover destination/source/service restrictions and expired actor snapshots without a refresh. Existing Thought and community regression tests use the explicit recovery adapter.

# Agent Note: Verify community source evidence at each asset read

Status: implemented

## Problem

A community reader can view certain published articles belonging to another account, but that access must not become a general ability to browse the author's files. A signed short-lived assertion alone can outlive a publication change or a reader's revoked article membership.

## Decision

`fpl_thought/community_access.py` checks the browser Session viewer against the currently active publication, published article, effective role, current note content or current multitable snapshot. A cover must match the publication's current cover. It produces only a viewer, source account, publication, exact asset and current publication/article/note revisions; an unbound registry session is required, and no source-account session is passed to the caller. A pending community upload is not treated as a published-body reference.

Identity's private community-asset endpoint authenticates the Thought service, validates the original signed browser request and live Session, and issues a distinct EdDSA capability for exactly that URL, viewer and evidence with a five-second maximum lifetime. It cannot authorize an alternate publication or asset URL, nor an API key. The original assertion and capability exist only in request memory and are not persisted as task records.

For each private Assets read, `CommunityAssetChecks` revalidates the capability with Identity and then calls Thought's private evidence verifier using an independent Assets-to-Thought peer credential. Thought verifies the signature and original request, rechecks the live Session, opens a fresh unbound source registry session and compares freshly resolved evidence including all revisions. Assets revalidates the capability after network waits, binds only the confirmed source account in its own database, and reads only that account's ordinary library file. Browser Origin/Cookie requests and missing verification bindings fail closed. No private endpoint appears in public OpenAPI.

## Alternatives considered

- Passing a chosen source owner to the regular private-library API grants a wider capability than the publication permits.
- A five-second signature without a fresh source check still serves a removed reference or revoked member within that window.
- Reading the Thought or Identity database from Assets violates service ownership and weakens independent recovery.
- Returning source filesystem paths or an author's browser Session to the viewer exposes unrelated private state.

## Consequences

The private protocol limits reads to one currently verified file. Each access requires Identity and Thought to be available; failure cannot fall back to source-account impersonation or stale evidence. A revocation after the final source check cannot retract bytes already being streamed; the capability also expires within five seconds. Uploads require a distinct authorized staging and commit protocol and are not opened by this read capability.

The independent browser route adapter now obtains a request-bound Identity grant, streams the Assets response without forwarding browser credentials or redirects, and keeps the original query shape; thumbnail size hints currently return the original file. The incomplete independent Thought application now assembles the browser adapter, verifier and publication read routes. The recovery-site file methods load their Assets implementation only when called so the independent read-only process does not import the Assets ORM. Its readiness probe remains closed and production peer credentials are not configured. The existing recovery website still uses its existing same-process community implementation. Independent read activation requires explicit credential provisioning, complete service assembly, user-facing behavior and full container/browser acceptance; none is implied by these private protocol tests.

## Verification

Real isolated Identity, Thought and Assets databases communicate over in-process HTTP using the actual signing, private Assets file read and Thought evidence callback. Tests exercise a different viewer and source account, matching actual file bytes, changed owner/revision, unreferenced file, current member removal, note-body change, publication withdrawal, logout, browser and wrong-peer denial, missing verifier and capability expiry. Additional isolated tests cover cover evidence, invisible article, multitable-aware selection and API-key denial. No formal data or external providers are used.

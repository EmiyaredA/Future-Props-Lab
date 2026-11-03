# Agent Note: Isolated gateway bridge for Creative source evidence

Status: implemented

## Problem

The existing Caddy authentication assertion covers only a request method and path. A Creative service cannot prove to another service which source ID was present in the user's original JSON. A shared HTTP client also retains upstream cookies across requests, and a failed connection after forwarding cannot establish whether the original write committed.

## Decision

`fpl_gateway/creative_bridge.py` supplies an unmounted, fixed-path ASGI bridge for Creative source imports. It accepts only a strong, distinct ingress secret and a valid Creative source assertion, rejects unexpected methods, queries, encodings, duplicate JSON keys and oversize bodies, then sends the original bytes to Identity over its exclusive Gateway credential. It independently verifies the returned short-lived evidence against the actor, source request ID, exact bytes, kind and source ID before forwarding the same bytes to Creative. Browser Cookie, Authorization and externally supplied evidence are not forwarded.

Each request uses separate Identity and Creative HTTP clients, so upstream cookies cannot cross accounts or upstreams. An Identity failure prevents forwarding; a transport failure after forwarding is explicitly reported as an unknown import outcome and is never retried by the bridge.

The bridge is not mounted in the production Gateway or Caddy configuration. Before it can be enabled, the launcher must restrict it to a container-private Unix socket and unique ingress credential, the Creative consumer must verify the evidence and current authorization, and the import requires stable durable intent/receipt recovery for a lost response. The evidence proves original request bytes, not that any installation batch reflects a published release; that remains an independent authorization gate.

## Alternatives considered

- A body digest supplied by Creative or the browser alone is not proof of the original request.
- Reusing a global upstream HTTP client retains cookies across requests and can leak identity.
- Automatically retrying a failed Creative POST can duplicate a committed import.
- Exposing the bridge on Gateway's private-network TCP port would let other containers attempt to invoke it.

## Consequences

The testable source-body boundary exists without enabling an incomplete production flow. Full service activation still requires socket and credential isolation, consumer checks, durable import receipts, current published-version proof and real container acceptance.

## Verification

ASGI tests exercise exact-byte forwarding and mismatched/forged evidence, Identity refusal or timeout without forwarding, malicious upstream cookies and concurrent accounts, ingress denial, malformed or oversize JSON, and unknown target delivery without retries. Identity signing is separately tested against real isolated Identity sessions and API keys.

# Agent Note: Authenticate Creative installation target results

Status: implemented

## Problem

A Creative source must not treat an unauthenticated target response as a committed installation, a safe cancellation, or proof that a prior receipt is absent. Replaying an old absence response could otherwise trigger a new submission after the target has committed.

## Decision

The private Integrations target signs successful install, receipt and cancellation responses, including a receipt-not-found response, with a dedicated HMAC key. The signature binds action, operation ID, immutable batch fingerprint, HTTP status, exact response bytes and a fresh random request nonce. The key is distinct from both peer credentials. The Creative target client sends a new nonce for each call, verifies the signature before interpreting a response, bounds response size and uses a fresh HTTP client without redirects or retries. An unsigned, forged or stale 404 is unavailable rather than an absence proof.

The install coordinator consumes verified result envelopes. A cancellation response reporting an existing committed receipt retains the signed envelope until the nested receipt is independently extracted. A verified cancellation is settled only after source authorization is rechecked, and an unknown target response leaves the source fence untouched.

## Alternatives considered

- Trusting HTTP status alone permits a forged or replayed absence to be mistaken for a safe retry.
- Signing only the operation ID permits a different batch or action to reuse a result.
- Omitting a per-request nonce permits replay of a previously authentic absence.

## Consequences

This is an explicitly assembled private transport and not a production entrypoint. A future deployment must provision the result key separately and ensure it is distinct from every service and ingress credential. The existing HTTP authority requires it before serving signed results. The target client fails closed for Skill installations without an injected archive provider. An isolated provider is documented in [the archive transport decision](2026-11-03-creative-skill-archive-transport.md); its size and cross-version limits, production gateway ingress, service lifecycle, complete Thought interfaces and data transfer remain unresolved. Error and timeout results never constitute proof of absence or cancellation.

## Verification

Tests with separate temporary Creative and Integrations databases and actual private ASGI routes exercise original request evidence, persistent publication fences, signed not-found, successful tool installation, authenticated receipt, cancellation reporting an already committed result, authenticated cancellation and source settlement. Additional tests reject modified bodies, modified nonces, unsigned 404s and replayed signed 404s. A lost source decision retains the publication fence and an exact retry commits only once. No real data or credentials are used.

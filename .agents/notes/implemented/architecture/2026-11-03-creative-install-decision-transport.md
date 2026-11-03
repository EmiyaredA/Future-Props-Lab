# Agent Note: Transport Creative installation decisions to Integrations

Status: implemented

## Problem

The target must not accept an installation decision calculated from its own caller-supplied batch, and the source cannot verify the user's install request without its exact gateway-attested bytes. Service credentials and browser session credentials have different purposes and must not be interchangeable.

## Decision

A private, bounded context carries the original assertion, request-body evidence and base64-encoded exact request bytes alongside a complete batch. The Integrations authority requires a dedicated Creative peer credential and refuses browser cookies and Origin headers, then sends the exact batch and context to Creative using a distinct Integrations credential and a fresh HTTP client. Creative's private decision endpoint accepts only that peer, rejects cookies and Origin, validates bounded strict JSON and delegates to the existing source authorization, persisted outbox and publication fence. The target independently checks returned account, action, operation, fingerprint and short expiry before use. Install, receipt and cancellation are separate purposes.

The endpoint and target authority require explicit assembly. Neither has a production credential or active deployment by default. Existing internal requests without a configured authorizer continue to fail closed; preview and stdio setup do not gain new authorization from this transport.

## Alternatives considered

- A caller-provided digest without a source lookup does not prove the accepted batch or published version.
- Forwarding browser credentials would give an independent service more authority than needed.
- A shared long-lived HTTP client could retain upstream cookies across accounts.

## Consequences

This decision transport is not a complete installation flow. Creative still needs an authenticated target-result transport and Skill archive sender, production credential lifecycle, supervised gateway ingress and full service assembly. Private contexts and credentials must not be logged. Only a verified target receipt or cancellation may release a publication fence. The two peers' credentials must remain distinct from one another and all other service or ingress credentials when assembled.

## Verification

A test with independently migrated Creative and Integrations databases and actual ASGI routes exercises the signed source assertion and body evidence, exact batch, separate peer credentials, install/receipt/cancel actions, session revocation, forged input and browser-origin rejection. It also simulates a lost Creative decision after the source fence commits: the target reports unavailability, the fence survives, and an exact retry installs only once. Tests use temporary databases and synthetic credentials.

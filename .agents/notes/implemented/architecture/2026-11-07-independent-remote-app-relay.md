# Agent Note: Connect Mac app windows to independent Remote

Status: implemented

## Problem

A deployment with remote app windows enabled cannot switch to the
independent stack while its Remote routes only return the disabled
response. The compatibility website also has to release its SSH reverse
listener during a reload so the next worker can bind the same public
port.

## Decision

Independent Remote owns browser tickets, signaling and idle expiry.
Identity verifies the browser destination and live cloud authority.
The existing Mac worker reads the catalog and uses its durable receipt
flow for allow-list writes. It checks current authority under the config
CAS before applying a change. The worker claims one bounded signaling
session over the authenticated native loopback path and starts the local
helper. Browser and Mac exchange media over WebRTC.

Keep the helper path in the Mac config and project app IDs and the
feature switch to Remote. Carry TURN settings in the private Remote
transport configuration. On website shutdown, close the SSH child
before awaiting the poll task and probe the loopback listener with the
configured public Host.

## Alternatives considered

Mounting the host capture program into a container would cross the
capture and deployment boundary. Opening a new Mac listener would add
another exposed host endpoint. The existing outbound worker bridge
covers the low-volume signaling traffic.

## Consequences

A ticket is single-use and tied to the account, browser session and
ingress. Closing the browser socket releases the worker's session.
Polling keeps stream state bounded and disposable. Catalog and config
requests use the existing durable native queue.

## Verification

The isolated Remote test runs the actual worker against Identity and
checks trusted-local settings, password revalidation, app filtering,
CAS conflicts, WebSocket negotiation, and logout revocation. The tunnel
test exercises shutdown after a failed public readiness probe.

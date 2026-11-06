# Agent Note: Inject Identity directory into community asset evidence

Status: implemented

## Problem

Evidence verification placed the Identity directory in a database session
even though its caller had already constructed the authenticated port.

## Decision

Pass the account directory explicitly to browser and peer evidence reads.
Read publication state in an unbound source session after revalidating
the viewer. Keep the existing article, asset revision and scope checks.

## Alternatives considered

Copying the service locator into a fresh source session would carry
request dependencies alongside the storage ownership flags.

## Consequences

Evidence verification requires an explicit Identity reader and can be
tested with an alternate implementation without changing session metadata.

## Verification

Community asset evidence and the independent Identity integration
exercise authenticated reads, revocation and source ownership.

## Follow-up

Community reads, publication management and independent edits and
uploads now also receive the explicit directory. Adapters rebind it
to the authorized source transaction and preserve the live viewer
and short-lived Identity profile checks.

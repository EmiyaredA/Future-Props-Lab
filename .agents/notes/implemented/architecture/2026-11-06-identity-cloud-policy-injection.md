# Agent Note: Inject Identity cloud policy

Status: implemented

## Problem

Cloud authorization read process-global policy even when the session came
from a separately assembled website. Individual fields in one status
response could also reflect different policy revisions.

## Decision

Identity's policy predicates and cloud authorization queries require a
settings snapshot. Website and independent Identity assembly supply a policy reader
to the HTTP boundary and to long-lived components. The website launcher
selects the hot TOML reader, and independent Identity selects the committed
policy projection. A directly constructed website uses its own settings by
default.

## Alternatives considered

Using startup settings for every deployment would delay policy revocations
until a restart. Reading policy inside each predicate would keep the
dependency implicit and allow contradictory fields in a single response.

## Consequences

Status and internal authority responses share one snapshot per request.
Desktop admission and active checks, Happier grants, and unlock writes
refresh at their respective authorization points. Account scope, stored
grants, and public protocol stay compatible.

## Verification

The isolated website test uses two migrated databases and actual account
sessions. It verifies independent policy readers, a consistent status
snapshot, and an active desktop check observing policy revocation. The
independent Identity test verifies a previously signed request after
revocation. The architecture gate covers the entire Identity package.

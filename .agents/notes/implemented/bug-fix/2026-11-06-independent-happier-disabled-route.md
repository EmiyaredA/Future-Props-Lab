# Agent Note: Independent Happier launch contract

Status: implemented

## Problem

The public catalog assigns Happier launch to Gateway. The independent Gateway validates its own registered routes against the catalog at startup, so a missing operation prevents all business traffic from starting.

## Decision

Both assemblies use the same public response contract. The independent Gateway uses the signed Studio identity and the existing Cloud Control route permission, then returns the established disabled response. The compatibility website continues to issue tickets when configured.

## Alternatives considered

Dropping the operation from the independent catalog would change the published contract. Loading the compatibility website handler in Gateway would bring Identity storage and website ingress into the image.

## Consequences

An independent deployment can start with the complete public catalog while Happier is disabled. Issuing tickets in that deployment requires an explicit authority interface.

## Verification

The isolated Gateway scenario compares the registered operations with the catalog and checks unauthenticated, unauthorized, and authorized disabled responses for both ingress types.

# Agent Note: Group repository Compose manifests

Status: implemented

## Problem

Base and overlay Compose files share the deployment root with contracts
and image definitions. Moving them also changes Docker Compose's default
relative path base, which can affect an existing deployment configuration.

## Decision

Repository manifests live in deploy/compose. The host resolves the former
repository base path when the file has moved and explicitly keeps deploy
as the project directory. External sealed release manifests keep their
own project directory.

## Alternatives considered

A filesystem link would leave two entry paths and bypass the deployment
check that rejects linked manifests.

## Consequences

Overlay discovery stays local to the base manifest. Relative credentials
and binds remain anchored to the original repository deployment root.

## Verification

Deployment tests cover the previous and current configuration paths,
symbolic link handling, overlay order, and service image ownership.

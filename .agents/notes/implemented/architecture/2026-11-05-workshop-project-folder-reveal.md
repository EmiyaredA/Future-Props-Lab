# Agent Note: Native reveal for Visual and Galgame project folders

Status: implemented

## Problem

Visual and Galgame lacked the published local project-folder operation in their independent services. The Video implementation already had the local-session grant, scoped Assets layout and native receipt sequence.

## Decision

Reuse the sequence with exact application, project and destination pairs. Keep the Video worker operation and payload stable. Visual and Galgame receive distinct native operation IDs. Assets verifies the owned Canvas or Story projection and rejects lexical path links before creating the corresponding directory. The worker resolves only a directory inside the configured Assets root.

## Alternatives considered

A generic path argument would allow the caller to request a host directory unrelated to its account or project. Repeating the browser and peer checks in each owner would make their authorization behavior diverge.

## Consequences

A local Browser Session can open an owned Video, Visual or Galgame project through Tools. Public ingress, cross-account IDs and path substitutions are rejected. The final Finder request is executed once when receipt delivery is retried.

## Verification

Signed integration tests for all three owners exercise the same public operation contract, local ingress, missing or foreign project IDs, symlinks inside and outside the Assets root and a lost worker acknowledgement.

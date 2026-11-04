# Agent Note: Build the Thought browser entry independently

Status: implemented

## Problem

Thought needs its own versioned browser release. Private library routes, community routes and compatibility links must resolve identically when opened from either website entry. The loading scene needs local program assets even when Portal is unavailable.

## Decision

Let the Thought module own route matching and URL generation for all its existing page families. The independent entry uses the shared browser Session and navigation protection, and loads private, community and compatibility pages directly. Bundle the loading scene assets with each independent release and resolve them against the versioned program base. Preserve the main website boot scene.

## Alternatives considered

- Loading the entire compatibility application in the Thought bundle would include other workshops and tie their releases together.
- Maintaining a second copy of community route patterns would let existing URLs diverge over time.

## Consequences

`npm run services:build:web -- thought` builds the separate entry with a contract and file manifest. The backend remains subject to its service completion and migration gates. Public page addresses are unchanged.

## Verification

Thought, Creative and Portal browser releases build with owned loading assets. Route tests compare the compatibility router with the Thought module for private, community and legacy links.

# Agent Note: Website routing controller

Status: implemented

## Problem

The website page component mixed page assembly with browser history and unsaved navigation state.
Page-specific composition adapters also lived beside presentation-only shells, obscuring which
component owned navigation continuations and event listener cleanup.

## Decision

Page assembly and specialized route adapters live in app/routing. useWebsiteNavigation owns route
state, browser history, unsaved continuations and browser/Agent event subscriptions. WebsiteRoutes
consumes its explicit navigation result and selects pages and layout shells. Features retain drafts;
the controller only asks the active editor whether navigation should wait.

The public URL type, parser and path generator stay in app/routes.ts. That module has substantive
contract ownership and remains the evidence target used by protected product documentation.

## Alternatives considered

- A file move alone would retain mixed lifecycle responsibilities in the page component.
- Moving navigation into a feature would create a reverse dependency on application routing.
- A shared mutable global router would mix mount lifetimes and account sessions.

## Consequences

Paths, lazy loading, permission branches and entry points remain compatible. Layout contains shells
and headers, while routing connects them to feature pages. Listeners are removed on unmount; a
cancelled Agent request cannot complete a deferred editor continuation.

## Verification

48 component cases cover navigation, sidebar, application selection and responsive route inventory.
Controller cases exercise deferred navigation with query state, interrupted browser history,
invalidated Agent requests, saved document URL replacement and listener cleanup. Type checking, production build, architecture,
format and lint validate the reorganized imports. Protected document paths remain unchanged.

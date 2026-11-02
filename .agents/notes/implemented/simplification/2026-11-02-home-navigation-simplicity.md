# Agent Note: One purposeful action per home destination

Status: implemented

## Problem

Decorative navigation arrows repeat across homepage cards, headers and callouts. Model and agent overview rows each navigate to the same page as their management button; the test panel has two identical actions; the integrations header repeats its first category. This increases visual noise and keyboard stops without adding choices.

## Decision

Remove decorative jump arrows from the homepage and retain explicit expand/collapse indicators. Model types and supported agent clients are static semantic lists, with one management button per equal-width panel. The test mode selector remains interactive and one labeled action preserves the selected mode in the existing URL. Integration categories provide the four distinct destinations without a duplicated header action. Resource headers accept optional navigation actions; file view-all and type filters, preview controls, tool directory and tool shortcuts remain distinct because their results differ.

## Alternatives considered

Hiding arrows with CSS would leave unnecessary navigation controls and keyboard stops. Making an entire panel clickable would blur the distinction between static overview content and the chosen action, and would complicate nested test controls and file previews.

## Consequences

Homepage navigation retains current routes, permissions and state ownership. Quiet surface and border feedback plus existing focus rings identify interactive cards. Model and agent columns remain equal. No HTTP API, persistence or authentication changes are introduced.

## Verification

19 related component tests and eight isolated browser journeys pass. They verify absence of jump arrows, exactly one model/agent/test action, preserved test-mode navigation, direct integration categories, file upload and preview entry distinctions, folder hover and keyboard/touch handling, independent collapse, and themes/layout at 1440, 1280 and 390px.

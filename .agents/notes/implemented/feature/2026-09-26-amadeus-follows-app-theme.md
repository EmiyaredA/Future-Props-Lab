# Agent Note: Amadeus follows the application appearance

Status: implemented

## Problem

Amadeus opens in a separate Electron window. Its page did not apply the Studio appearance preference, and its fixed light palette stayed light when the application switched to dark mode.

## Decision

The Amadeus entry applies the saved theme before rendering and subscribes to the existing `useTheme` synchronization. Both windows share the Studio origin and theme storage key, so the existing browser `storage` event carries changes across windows. Amadeus defines a dark palette under the same root `data-theme` attribute as the main application.

## Alternatives considered

- **Publish theme changes through Electron IPC** — would add a second synchronization path for a preference already shared by same-origin windows.
- **Keep Amadeus light regardless of Studio appearance** — does not meet the expectation that application appearance is consistent.

## Consequences

- **收益**：Amadeus starts with the current application appearance and updates when the user changes it in the main window.
- **代价与已知上限**：Synchronization relies on Amadeus and Studio continuing to share the same origin and theme storage key.

## Verification

Open Amadeus, switch the Studio appearance between light and dark, and confirm the Amadeus surfaces, messages, controls, and popovers update with it. Reopen Amadeus in each mode to confirm the initial appearance matches.

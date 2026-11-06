# Agent Note: Verify the active slide and its saved neighbors on reopen

Status: implemented

## Problem

Some browser assertions expected reopening a deck to select its first
slide. The editor now restores the active slide. The transparent-frame
test also attempted to click through the floating toolbar.

## Decision

Assert the restored slide first, then navigate to the original slide to
verify its saved text and notes. Click a visible border segment clear of
the floating toolbar to verify independent frame selection.

## Alternatives considered

Forcing the border click would bypass the browser hit testing this
scenario is intended to verify.

## Consequences

The acceptance scenarios cover active-slide restoration together with
text, notes, property history, and transparent-frame selection.

## Verification

Chromium ran the complete presentation history, selection, interface
and workshop specs using the built website.

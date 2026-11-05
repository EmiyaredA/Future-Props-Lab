# Agent Note: Visual generation source and result settlement

Status: implemented

## Problem

Independent Visual must own the published generation requests, queue records, Canvas revision and batch history, while Models owns execution and Assets owns published originals. A failed Canvas write, interrupted provider submit or dropped publication response must leave an actionable state.

## Decision

Visual freezes the Canvas input and persists a source intent before Models prepares it. The task and Canvas link commit with the decision to activate that exact plan. Models retains the original image and video waiting policy alongside execution capacity. The shared driver never resubmits an interrupted provider call with an unknown result. Visual projects status and copies the signed result only after validating its size and SHA256. The result, Canvas output and Assets source receipt commit together. The task completes after Assets acknowledges publication, then Models can retire its private duplicate. Completed child tasks drive the existing deterministic Rendering grid for composite batches.

## Alternatives considered

Starting the provider before the Canvas CAS would leave orphan jobs if the Canvas changed. Immediate admission of every child would reject valid batches under the default user execution quota. Trusting a task's remote completion alone would make a generated file visible before Assets can serve it.

## Consequences

The existing public task and batch contracts, cancel and retry entry points, and normalized provider inputs remain in use. A dedicated Visual-to-Models credential is mounted read-only through the generation Compose overlay. An old failed task that predates the independent dispatch retains its historical record and still requires its own continuation adapter for known provider results before cutover.

## Verification

Focused regressions cover the Visual and Models jobs, queue and capacity, real Rendering composite, exact original download, cancellation, publication references, provider-neutral AutoDL and Seedance inputs, architecture and image packaging. Seven-container run fpl-visual-native-generation-eb10e3b86a used a closed TLS SenseAudio fixture, restarted both Models and Visual with the provider task pending, and verified no second submit, exact PNG bytes, four distinct seeds and the rendered grid. Chromium exercised the published Visual entry.

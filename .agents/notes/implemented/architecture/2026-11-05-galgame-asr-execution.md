# Agent Note: Execute Galgame voice recognition through Models

Status: implemented

## Problem

Galgame owns project voice jobs and transcripts, while Assets owns original audio and Models owns provider credentials. A lost response must not trigger a second provider submission.

## Decision

Galgame records the selected model and exact original revision at admission. Assets streams only that project's original. Galgame and Models both check its size and SHA-256. Models reserves the attempt before provider execution and records its final outcome with the call log. Galgame queries that same attempt after a communication failure. When Models restarts with an interrupted provider attempt, it records an unknown result and does not submit again.

## Alternatives considered

Delegating to the model playground would expose Galgame work as playground data and lose the project's exact file and transcript revisions. Retrying a supplier request after a connection failure could create a duplicate paid operation.

## Consequences

Galgame keeps the published create and task history API. A repeated submission with the same active settings returns the existing task. Competing settings receive a conflict until the active job ends. A manual transcript edited after admission takes precedence over the background result. Provider credentials and call logs stay in Models.

## Verification

The signed ASR tests cover a lost completed reply, a cancelled provider call followed by restart recovery, and a newer manual edit. The Compose rehearsal used the released Galgame browser entry and a synthetic loopback OpenAI-compatible endpoint inside the isolated Models network namespace. It verified one upstream call and the same task result after Galgame restart.

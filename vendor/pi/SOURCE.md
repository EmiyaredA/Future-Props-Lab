# Pi source snapshot for Amadeus

Source: `/Users/tonghao/Projects/pi` at commit `19451accdeec671c1f4da9eafac8fc270f510ef4`.
License: MIT; see `LICENSE`.
Included runtime source and package manifests from `packages/agent`,
`packages/ai`, `packages/chord`, and `packages/telemetry`. Tests, examples,
benchmarks, generated output, and upstream maintenance scripts were omitted.
The FPL build uses these local workspace packages and does not refer to the
original absolute source path.

The upstream model catalog JSON was absent in the local checkout. FPL does not
use Pi's built-in model catalog; empty JSON entries permit type compilation.
`radius.ts` has a type-only cast so the empty catalog compiles. FPL uses its own
model catalog and provider credentials exclusively.

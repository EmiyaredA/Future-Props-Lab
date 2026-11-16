# FortuneSheet source inputs

Upstream: https://github.com/ruilisi/fortune-sheet, tag `v1.0.4` (MIT).
Official source archive SHA-256:
`08f9b07b197184775469b124c7502dc4f70f35c98d1a90fbe8df09ea19ebdb3e`.

Only `packages/core/src` and `packages/react/src` are vendored. The application
still locks the public npm packages and dependencies at 1.0.4 for their published
types and dependency graph. Vite consumes these original source modules so the
locale, rendering, editing and formula code can be split before bundling, rather
than shipping the npm package's indivisible multilingual bundle.

FPL modification, 2026-11-16: locale registration includes Chinese and English
only. The original other locale source files are retained for provenance.
All application-specific behavior lives in the spreadsheet feature adapter.
Do not edit installed `node_modules` or rewrite generated build output.

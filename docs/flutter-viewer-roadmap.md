# Flutter Viewer Migration Roadmap

## Invariants

1. `intelligence/code-graph.mjs` remains the authoritative graph view model builder.
2. Flutter consumes generated data; it does not introduce a hand-maintained relationship graph.
3. The production JavaScript viewer remains available until Flutter reaches tested feature parity.
4. TotemCore remains the world-space origin.
5. Relationship semantics, RAG, MCP, and contract audits are unchanged by renderer migration.

## Phase 1 — renderer foundation

- Flutter package under `viewer_flutter/`
- generated JSON asset from `buildGraphViewModel()`
- module/external 3D projection with `CustomPainter`
- deterministic positions, directed contract edges, selection, camera interaction
- web/Wasm CI

## Phase 2 — 3D parity

- curated feature clusters
- shared capabilities and precise feature endpoints
- relation-aware weighted junction placement
- line-type filters
- expanded-center suppression
- spotlight and full keyboard/touch parity

## Phase 3 — local live source

- consume the existing loopback local workspace API on Flutter Web
- native desktop source for Git HEAD/branch/dirty/drift
- incremental index refresh without browser reload where possible

## Phase 4 — developer console

- changed files and diffs
- impact/test-plan panels
- OpenSpec status
- MCP/RAG query surface
- CI/release state

## Phase 5 — production cutover

Flutter Web replaces the JavaScript Pages viewer only after parity validation. The legacy renderer is removed in a separate, explicit change.

# Flutter Viewer Migration Roadmap

## Invariants

1. `intelligence/code-graph.mjs` remains the authoritative graph view model builder.
2. Flutter consumes generated data; it does not introduce a hand-maintained relationship graph.
3. The production JavaScript viewer remains available until Flutter reaches tested feature parity.
4. TotemCore remains the world-space origin.
5. Relationship semantics, RAG, MCP, and contract audits are unchanged by renderer migration.

## Phase 1 — renderer foundation ✅

- Flutter package under `viewer_flutter/`
- generated JSON asset from `buildGraphViewModel()`
- module/external 3D projection with `CustomPainter`
- deterministic positions, directed contract edges, selection, camera interaction
- web/Wasm CI

## Phase 2 — 3D architecture parity ✅

- curated feature clusters
- shared capabilities and precise feature endpoints
- relation-aware weighted junction placement with deterministic slotting
- line-type filters for the seven architecture relationship families
- expanded-center suppression: expanded modules never receive fallback contract lines at their center
- child-node spotlight and related-cluster emphasis
- module expand/collapse and expand-all controls
- desktop left-drag rotation, right-drag pan, wheel zoom
- touch one-finger rotation plus two-finger zoom/pan
- keyboard node navigation, Enter/Space activation, Home/Core, End, Escape
- regression tests for endpoint retargeting, center suppression, filters, Shared Manual symmetry, deterministic layout, and multi-relation junction bias

Phase 2 intentionally covers curated architecture nodes first. Generated code-detail category/file/symbol drill-down remains a later parity item before production cutover.

## Phase 3 — local live source

- consume the existing loopback local workspace API on Flutter Web
- native desktop source for Git HEAD/branch/dirty/drift
- incremental index refresh without browser reload where possible
- keep absolute repository paths out of browser-facing status payloads

## Phase 4 — developer console

- changed files and diffs
- impact/test-plan panels
- OpenSpec status
- MCP/RAG query surface
- CI/release state

## Phase 5 — production cutover

Before cutover, Flutter must also cover generated code-detail browsing and the existing local-live workflow. Flutter Web replaces the JavaScript Pages viewer only after parity validation. The legacy renderer is removed in a separate, explicit change.

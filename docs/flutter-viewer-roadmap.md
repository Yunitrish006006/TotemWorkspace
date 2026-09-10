# Flutter Viewer Roadmap

Flutter production cutover is complete. This document now records the completed migration invariants and remaining Flutter-native enhancements.

## Invariants

1. `intelligence/code-graph.mjs` remains the authoritative graph view-model builder.
2. Flutter consumes generated data; it does not introduce a hand-maintained relationship graph.
3. Flutter Web/Wasm is the only maintained Viewer surface.
4. TotemCore remains the world-space origin.
5. Relationship semantics, RAG, MCP and contract audits remain independent of renderer implementation.
6. Node.js remains the Workspace Intelligence / Bridge / runtime layer; it is not a browser rendering surface.

## Phase 1 — renderer foundation ✅

- Flutter package under `viewer_flutter/`
- generated JSON asset from `buildGraphViewModel()`
- module/external 3D projection with `CustomPainter`
- deterministic positions, directed contract edges, selection and camera interaction
- web/Wasm CI

## Phase 2 — architecture and semantic LOD ✅

- curated feature clusters
- shared capabilities and precise feature endpoints
- relation-aware deterministic layout
- relationship-family filters
- child-node spotlight and related-cluster emphasis
- module expand/collapse controls
- desktop, touch and keyboard interaction
- progressive `Module → Feature → Component → Implementation` LOD
- production-code-only implementation evidence
- Verification Graph / Test entities

## Phase 3 — LIVE LOCAL ✅

- loopback Local Bridge integration
- auto-discovery of `127.0.0.1:18765`
- Git HEAD / branch / dirty / snapshot-drift status
- locale coverage
- incremental index refresh through `/api/refresh`
- in-place `/api/graph-data` reload
- browser-facing payloads exclude absolute repository paths
- approved loopback / TotemWorkspace Pages CORS boundaries
- Prompt remains opt-in and Agent Activity remains independent

## Phase 4 — development intelligence ✅

- Change Intelligence
- impact propagation
- Verification Graph and verification state
- Agent Activity with semantic source-location focus
- Prompt / Codex Agent Adapter
- schema-v2 execution constraints and model policy
- Development Replay
- Discord / Flutter shared local conversation and task surfaces

## Phase 5 — production cutover ✅

- Flutter owns the GitHub Pages repository root
- Flutter owns the Local Bridge UI root
- old browser JavaScript renderer, live adapter and generated JS graph artifact removed
- `/legacy/` deployment removed
- CI no longer requires JavaScript/Flutter viewer parity
- graph generation targets `viewer_flutter/assets/graph-data.json`

## Remaining work

Future viewer work should be implemented directly in Flutter. Native desktop packaging can be added when useful, but must reuse the same graph/runtime contracts rather than introduce another renderer-specific architecture source.

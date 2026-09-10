---
name: totem-workspace-intelligence
description: Use for development, debugging, architecture, impact analysis, review, or cross-module changes in the Totem Minecraft/Fabric mod suite. Resolve work through TotemWorkspace graph knowledge and bounded context before broad repository reading; use impact and test-plan checks after edits.
---

# Totem Workspace Intelligence

Use TotemWorkspace as the narrowing and execution-constraint layer for non-trivial work across the Totem mod family.

## Retrieval order

1. Before broad repository search, call `totemWorkspace.resolve_task` when MCP is available.
2. For non-trivial work, call `totemWorkspace.orchestration_plan`. Its execution constraints are authoritative; agent topology remains the runtime's decision.
3. Call `totemWorkspace.context_pack` for bounded modules, contracts, symbols and tests. Audience labels are retrieval presets, never mandatory roles.
4. Search code only inside graph-selected modules unless evidence requires expansion. `search` and `context_pack` freshness-check selected modules and incrementally replace changed/new/deleted chunks.
5. Use `totemWorkspace.graph` when dependency direction or shared API ownership is unclear.
6. Use `totemWorkspace.refresh_index` only for explicit maintenance, diagnostics or forced full rebuilds.

CLI fallback from the TotemWorkspace root:

```sh
node scripts/totem-intelligence.mjs resolve "<task>"
node scripts/totem-intelligence.mjs orchestrate "<task>"
node scripts/totem-intelligence.mjs context "<task>" primary
node scripts/totem-intelligence.mjs search "<query>" totem-remnant,totem-nexus
node scripts/totem-intelligence.mjs refresh-index totem-remnant,totem-nexus
node scripts/totem-intelligence.mjs render-graph
```

## Source-of-truth rules

- `data/modules.json`, audited dependency contracts and curated architecture in `index.html` define the cross-module snapshot.
- Current sibling-repository source is authoritative for implementation details when it is newer than the snapshot.
- Generated graph detail is factual implementation evidence only. Files, symbols, components or visual edges never establish a new architecture contract by themselves.
- Use `workspace_status` when snapshot drift may matter. Never reset newer source merely to match an older snapshot.
- EventBus publishers do not depend on optional subscribers.
- Observer provider ownership, protocol boundaries, privacy, read-only behavior and framebuffer-free requirements remain mandatory.

## Shared execution contract

TotemWorkspace constrains work; it does not prescribe a fixed internal agent topology.
All non-trivial Totem development uses the same lifecycle from Flutter, Discord, Bridge, CLI, IDE or sibling-repository Codex:

```text
resolve_task
→ orchestration_plan
→ bounded context
→ implementation
→ impact
→ test_plan
→ required independent review when specified
→ actual validation
```

The same normalized task, semantic focus and workspace state must yield equivalent constraints. Respect module ownership, read/write scopes, dependency waves, maximum concurrent writes, shared-contract stabilization, impacted consumers, required validation, security and release gates.

An `independentReviewRequired` constraint requires actual independent review evidence, not a named agent role. Read-only waves never write. Never revert unrelated work from another contributor.

Correctness comes first, total model tokens second, latency last. Prefer bounded/lightweight execution when sufficient and reuse compact upstream findings. Escalate reasoning for ambiguous shared API/protocol design, conflicting evidence, high-risk persistence/networking or non-local failures. Model hints are preferences; only runtime evidence establishes actual model selection, agent lifecycle, usage or validation outcomes.

## After implementation

1. Call `totemWorkspace.impact` with changed files/modules. It refreshes directly touched code-index chunks and best-effort regenerates the Flutter graph asset.
2. Treat graph generation as non-authoritative presentation output. A graph warning must not convert successful RAG refresh, impact analysis, test planning, Gradle or GameTest work into failure.
3. Call `totemWorkspace.test_plan` with the task and touched modules.
4. Review all impacted consumers returned by the graph.
5. Run the owning repositories' real validation tasks; test-plan categories do not permit inventing nonexistent Gradle tasks.
6. When `independentReviewRequired` is true, complete and record independent review evidence.

## Generated graph policy

`viewer_flutter/assets/graph-data.json` is generated from `buildGraphViewModel()` and may contain bounded factual metadata such as relative source paths, symbols, components and discovered tests. It must not contain source bodies, secrets, screenshots/framebuffers or model-inferred dependency contracts.

Flutter is the only maintained viewer. The retired browser JavaScript viewer, `/legacy/` route and `viewer/generated/graph-data.js` must not be recreated.

## Local index policy

`.totem-index/` is disposable local state. Never commit or hand-edit it. A full `build-index` creates per-file metadata; subsequent `search`, `context_pack` and `impact` flows keep relevant chunks current incrementally. Successful refresh points may regenerate the Flutter graph asset, but graph generation remains non-fatal to intelligence correctness.

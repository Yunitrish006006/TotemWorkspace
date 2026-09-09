---
name: totem-workspace-intelligence
description: Use for development, debugging, architecture, impact analysis, review, or cross-module changes in the Totem Minecraft/Fabric mod suite. Resolve the request through TotemWorkspace graph knowledge and bounded context packs before broad repository reading; use impact and test-plan checks after edits.
---

# Totem Workspace Intelligence

Use the TotemWorkspace knowledge engine as the first narrowing layer for non-trivial work across the Totem mod family.

## Retrieval order

1. Before broad `grep`, repository-wide search, or reading several modules, call the `totemWorkspace.resolve_task` MCP tool when it is available.
2. For any non-trivial task, call `totemWorkspace.orchestration_plan`. Its execution constraints are authoritative; agent topology is Astra's decision.
3. Call `totemWorkspace.context_pack` for bounded relevant modules, contracts, symbols and tests. Start with `primary`; select a task-appropriate retrieval audience for bounded discovery, implementation or verification. Audience labels are retrieval presets, never mandatory agent roles.
4. Search code only inside the modules selected by the graph unless evidence requires expansion. `search` and `context_pack` automatically check those selected modules and incrementally replace chunks for changed/new/deleted files before retrieval.
5. Use `totemWorkspace.graph` when changing a shared API or when dependency direction is unclear.
6. Use `totemWorkspace.refresh_index` manually only for diagnostics, explicit maintenance, or a forced complete rebuild; normal narrowed retrieval does not require a manual refresh.

If the MCP server is unavailable, use the deterministic CLI from the TotemWorkspace repository:

```sh
node scripts/totem-intelligence.mjs resolve "<task>"
node scripts/totem-intelligence.mjs orchestrate "<task>"
node scripts/totem-intelligence.mjs context "<task>" primary
node scripts/totem-intelligence.mjs search "<query>" totem-remnant,totem-nexus
node scripts/totem-intelligence.mjs refresh-index totem-remnant,totem-nexus
node scripts/totem-intelligence.mjs render-graph
```

## Source-of-truth rules

- `data/modules.json`, the validated dependency contracts, and curated data in `index.html` define the cross-module architecture snapshot.
- The current local sibling repository source is authoritative for implementation details when its HEAD has moved beyond the snapshot.
- `graph-v2.html` and its generated code-detail nodes are presentation/retrieval aids only. A discovered file, symbol, category, or 3D edge must never be treated as evidence that a new architecture contract exists.
- Use `workspace_status` when snapshot drift could matter. Do not treat an older snapshot commit as a reason to overwrite newer local source.
- EventBus publishers do not depend on optional subscribers.
- Observer provider ownership, protocol boundaries, privacy, read-only behavior, and framebuffer-free requirements remain mandatory.

## Token-efficient execution

TotemWorkspace constrains the work. It does not prescribe the internal agent topology.
All non-trivial Totem development uses the same resolve_task -> orchestration_plan ->
bounded context -> implementation -> impact -> test_plan -> actual validation lifecycle,
from Web, Flutter, legacy Viewer, Discord, Bridge, CLI, IDE, or sibling repository Codex.
The same normalized task, semantic focus and workspace state must yield equivalent constraints.
Astra chooses direct work, delegation, specialization, scheduling and independent review.
Respect module ownership, read/write scopes, dependency waves, max concurrent writes,
shared-contract stabilization, impacted consumers, required validation, security and release gates.
An independentReviewRequired constraint requires actual independent review evidence, not a
particular agent role. Read-only waves never write. Never revert another contributor's work.
Prefer lightweight/Spark-capable available models for bounded discovery, implementation,
mechanical changes, tests and compact review when this reduces total task tokens.
Correctness comes first, total model tokens second, latency last. Reuse compact findings
and bounded context; prefer sequential work when it avoids repeated context. Escalate to
Astra reasoning for ambiguity, shared API/protocol design, conflicting evidence, high-risk
persistence/networking or non-local failures; supply compact evidence before escalation.
Model hints express preferences, not actual model usage. Only runtime evidence establishes
agent lifecycle, chosen models, usage or validation outcomes.

Pass each delegated task only its relevant modules, contracts, files, symbols, tests
and compact upstream findings. Do not repeat repository scans or send full workspace
context to every agent. Use graph, code index, impact and deterministic tools for facts.
Model routing uses the runtime catalog, with lightweight-preferred,
strong-reasoning-preferred or inherit-primary hints and graceful fallback. No fixed
role/model mapping or agent-count quota applies.

## After implementation

1. Call `totemWorkspace.impact` with changed files/modules. The MCP impact path proactively refreshes the directly touched module chunks and then attempts to regenerate `graph-v2.html`.
2. Treat V2 visualization regeneration as best-effort. A viewer warning must not block implementation, impact analysis, test planning, review, Gradle, or GameTest work.
3. Call `totemWorkspace.test_plan` with the task and touched modules.
4. Review every impacted consumer returned by the graph; reviewer context packs will also freshness-check their selected modules.
5. Run the repository's actual relevant Gradle/test tasks. The test-plan tool returns categories, not permission to invent nonexistent tasks.
6. When independentReviewRequired is true, complete an independent review and record actual evidence; Astra chooses its mechanism.

## Generated graph policy

The detailed V2 graph may grow as real indexed source changes, but its generated layer is intentionally factual and bounded:

- source-file path and indexed symbol names are allowed;
- code categories are deterministic display classifications;
- source bodies, secrets, screenshots/framebuffers, and model-written inferred dependencies are not graph data;
- generated code detail never rewrites curated dependency direction, EventBus semantics, optional-integration fallback, or Observer ownership/protocols;
- 3D rendering is presentation-only and must remain independent of MCP/RAG correctness.

## Local index policy

`.totem-index/` is disposable local state. Never commit it or hand-edit it. A full `build-index` creates schema-v2 per-file metadata; subsequent `search`, `context_pack`, and MCP `impact` flows keep relevant chunks current incrementally. A schema/workspace change automatically triggers a one-time full rebuild. Successful refresh points also attempt to rebuild the V2 HTML from the current index, but an HTML/viewer failure is non-fatal.

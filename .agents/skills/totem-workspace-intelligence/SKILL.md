---
name: totem-workspace-intelligence
description: Use for development, debugging, architecture, impact analysis, review, or cross-module changes in the Totem Minecraft/Fabric mod suite. Resolve the request through TotemWorkspace graph knowledge and bounded context packs before broad repository reading; use impact and test-plan checks after edits.
---

# Totem Workspace Intelligence

Use the TotemWorkspace knowledge engine as the first narrowing layer for non-trivial work across the Totem mod family.

## Retrieval order

1. Before broad `grep`, repository-wide search, or reading several modules, call the `totemWorkspace.resolve_task` MCP tool when it is available.
2. Call `totemWorkspace.context_pack` for the current audience:
   - `primary`: architecture/routing context with a small code slice.
   - `worker`: one module's implementation context plus required contracts.
   - `reviewer`: relevant contracts, diff-adjacent code, and validation obligations.
3. Search code only inside the modules selected by the graph unless evidence requires expansion. `search` and `context_pack` automatically check those selected modules and incrementally replace chunks for changed/new/deleted files before retrieval.
4. Use `totemWorkspace.graph` when changing a shared API or when dependency direction is unclear.
5. Use `totemWorkspace.refresh_index` manually only for diagnostics, explicit maintenance, or a forced complete rebuild; normal narrowed retrieval does not require a manual refresh.

If the MCP server is unavailable, use the deterministic CLI from the TotemWorkspace repository:

```sh
node scripts/totem-intelligence.mjs resolve "<task>"
node scripts/totem-intelligence.mjs context "<task>" primary
node scripts/totem-intelligence.mjs search "<query>" totem-remnant,totem-nexus
node scripts/totem-intelligence.mjs refresh-index totem-remnant,totem-nexus
```

## Source-of-truth rules

- `data/modules.json`, the validated dependency contracts, and `index.html` define the cross-module architecture snapshot.
- The current local sibling repository source is authoritative for implementation details when its HEAD has moved beyond the snapshot.
- Use `workspace_status` when snapshot drift could matter. Do not treat an older snapshot commit as a reason to overwrite newer local source.
- EventBus publishers do not depend on optional subscribers.
- Observer provider ownership, protocol boundaries, privacy, read-only behavior, and framebuffer-free requirements remain mandatory.

## Primary-model context policy

Minimize direct repository-wide reading by the primary coordinator.

Prefer subagents for:
- broad exploration and symbol tracing,
- repetitive module implementation,
- build-log diagnosis,
- compatibility investigation,
- independent integration review.

Give each subagent a bounded context pack and explicit module/file ownership. Stabilize shared contracts before parallel module writes.

## After implementation

1. Call `totemWorkspace.impact` with changed files/modules. The MCP impact path proactively refreshes the directly touched module chunks before review and validation.
2. Call `totemWorkspace.test_plan` with the task and touched modules.
3. Review every impacted consumer returned by the graph; reviewer context packs will also freshness-check their selected modules.
4. Run the repository's actual relevant Gradle/test tasks. The test-plan tool returns categories, not permission to invent nonexistent tasks.
5. For substantial changes, use an independent reviewer after implementation.

## Local index policy

`.totem-index/` is disposable local state. Never commit it or hand-edit it. A full `build-index` creates schema-v2 per-file metadata; subsequent `search`, `context_pack`, and MCP `impact` flows keep relevant chunks current incrementally. A schema/workspace change automatically triggers a one-time full rebuild.

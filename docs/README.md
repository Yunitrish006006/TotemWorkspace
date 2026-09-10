# TotemWorkspace documentation

This directory separates maintained operating documentation from point-in-time audit evidence.

## Maintained documentation

| Document | Purpose |
| --- | --- |
| [`current-status.md`](current-status.md) | Last verified 11-module source/release snapshot. Snapshot time is independent from ongoing TotemWorkspace tooling development. |
| [`module-catalog.md`](module-catalog.md) | Human-readable active module catalog. |
| [`dependency-contracts.md`](dependency-contracts.md) | Cross-module hard, optional, EventBus and Observer contract guidance. |
| [`development-guidelines.md`](development-guidelines.md) | Minecraft/Fabric development and integration rules. |
| [`release-checklist.md`](release-checklist.md) | Java 25, GitHub CI, Modrinth publish and read-back release gate. |
| [`codex-intelligence.md`](codex-intelligence.md) | Workspace Intelligence, MCP, indexing and runtime usage. |
| [`ai-development-graph-plan.md`](ai-development-graph-plan.md) | Current AI-development graph architecture plus future Symbol Intelligence scope. |
| [`local-live-viewer.md`](local-live-viewer.md) | Flutter Local Bridge operation and API boundary. |

The maintained viewer implementation is documented separately in [`../viewer_flutter/README.md`](../viewer_flutter/README.md).

## Audit and historical evidence

These files describe a specific audit/refactor point in time. They are useful evidence, but they are not the current operating specification when newer maintained docs or code disagree.

- [`relationship-audit-2026-09-03.md`](relationship-audit-2026-09-03.md) — reviewed dependency/relationship evidence supporting `data/relationship-audit.json`.
- [`history/2026-09-09-runtime-refactor-validation.md`](history/2026-09-09-runtime-refactor-validation.md) — archived validation record for the shared runtime refactor.

## Source-of-truth hierarchy

Use evidence in this order:

1. owning Totem repositories for live implementation details;
2. `data/*.json` plus curated `../index.html` architecture for the recorded cross-module snapshot;
3. maintained documentation in this directory for operating rules and explanations;
4. dated audit/validation records only as historical evidence.

Generated Flutter graph data and `.totem-index/` runtime/index state are derived artifacts, not architecture sources of truth.

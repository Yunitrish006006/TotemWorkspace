# Totem Workspace Intelligence

TotemWorkspace includes a repository-local Codex skill plus a dependency-aware local MCP server. The goal is to narrow a Totem task by module, feature, contract, and risk before the primary model reads large parts of the 11 repositories.

## What V1 provides

- Graph retrieval derived from the existing `index.html` feature graph and `data/modules.json` snapshot.
- Chinese/English aliases for common Totem concepts.
- Local lexical + symbol-aware code indexing across sibling Totem repositories.
- Automatic incremental freshness checks for selected modules before code retrieval.
- Task resolution, dependency neighborhood, impact analysis, test planning, workspace drift checks, and audience-specific context packs.
- Generated V2 architecture visualization that combines curated architecture with factual code-detail metadata.
- No embeddings, remote vector database, external graph database, or external visualization service is required.

The local index is disposable and lives under `.totem-index/`; it is not a source of truth and must not be committed.

## Expected local layout

```text
workspace/
├── TotemWorkspace/
├── TotemCore/
├── TotemRemnant/
├── TotemNexus/
├── TotemAutomata/
└── ...
```

If your layout differs, set `TOTEM_REPOS_ROOT` to the directory containing the module repositories and `TOTEM_WORKSPACE_ROOT` to the TotemWorkspace checkout.

## Build the local code index

From `TotemWorkspace`:

```sh
node scripts/totem-intelligence.mjs build-index
```

The curated architecture graph itself does not need an index build; it is derived directly from the validated repository sources. Code search and generated code-detail visualization use `.totem-index/code-index.json` when present. A successful `build-index` also regenerates `viewer/generated/graph-data.js`.

The code index uses schema v2 per-file metadata: file size, modification time, content SHA-256, module repository HEAD/branch, and a Git worktree fingerprint. After the first full build, narrowed retrieval checks only selected modules and replaces chunks only for changed, new, deleted, or hash-mismatched files.

Useful CLI checks:

```sh
node scripts/totem-intelligence.mjs summary
node scripts/totem-intelligence.mjs resolve "死亡背包跟 Nexus 同步有問題"
node scripts/totem-intelligence.mjs orchestrate "死亡背包跟 Nexus 同步有問題"
node scripts/totem-intelligence.mjs graph totem-remnant 2
node scripts/totem-intelligence.mjs context "銅魁儡背包防巢狀" primary
node scripts/totem-intelligence.mjs search "death node snapshot" totem-remnant,totem-nexus
node scripts/totem-intelligence.mjs refresh-index totem-remnant,totem-nexus
node scripts/totem-intelligence.mjs render-graph
node scripts/totem-intelligence.mjs status
```

`refresh-index` is normally unnecessary because `search` and `context` automatically freshness-check selected modules. `build-index` remains the explicit full rebuild command.

## Architecture visualization V2

V2 intentionally separates presentation code from graph data:

```text
graph-v2.html
viewer/graph-v2.css
viewer/graph-v2-adapter.js
viewer/graph-v2.js
viewer/generated/graph-data.js
```

The boundary is strict:

- `graph-v2.html` is a renderer shell only. It contains no module, feature, contract, file, symbol, or code-index data.
- `viewer/graph-v2.css`, `viewer/graph-v2-adapter.js`, and `viewer/graph-v2.js` are stable presentation assets.
- `viewer/generated/graph-data.js` is the only generated V2 data artifact. Normal source/architecture changes regenerate this file rather than rewriting HTML/CSS/renderer code.
- The generated data file is derived from the same validated `loadKnowledge()` graph used by MCP plus the local code index; it is not a third manually maintained dependency graph.

The visualization has two knowledge levels:

1. **Curated architecture** — 11 active modules, 58 feature branches, hard dependencies, Fabric `suggests`, runtime optional contracts, EventBus relationships, external services, and Observer provider contracts.
2. **Generated code detail** — deterministic metadata for indexed code categories, real relative source-file paths, test files, and indexed symbol names.

Generated code detail deliberately excludes source bodies and cannot create or redefine module contracts.

### 2D layered view

The V2 overview uses left-to-right rank hints. Forward edges remain monotonic. A semantic relationship that must point toward an earlier visual layer is routed through a separate rail instead of cutting back through the main dependency tree.

Selecting a module opens a bounded detail tree:

```text
module
├── curated feature
└── generated code category
    └── real file
        └── indexed symbol
```

File blocks allocate vertical space from their symbol count so added detail does not simply overlap existing nodes.

### 3D preview isolation

3D is a Canvas presentation mode that reads the same generated view model. It has no authority over architecture or automation:

- it never feeds data back into MCP or RAG;
- it never changes dependency/contracts;
- it is not required for indexing, impact analysis, test planning, or build validation;
- a visualization-data generation failure is returned as a warning and cannot make a successful code-index refresh or `impact` call fail.

## Automatic graph update flow

For a normal edit:

```text
implementation
  -> impact
      -> refresh touched code-index chunks
      -> regenerate viewer/generated/graph-data.js
  -> test_plan
  -> reviewer context
  -> Gradle / GameTest validation
```

If `search` or `context_pack` discovers an index change before `impact`, MCP also attempts to refresh generated graph data. The HTML/CSS/renderer files remain unchanged during normal data refreshes.

The graph becomes more detailed as the index sees real files and symbols, but those details are not automatically promoted into architecture facts. Only curated architecture may define dependency direction, ownership, optional-contract semantics, EventBus relationships, or Observer protocol ownership.

## Register the MCP server with Codex

Add a server entry to the Codex configuration used by the same operating-system user that runs CodexDiscord. Replace the example paths with real absolute paths:

```toml
[mcp_servers.totemWorkspace]
command = "node"
args = ["/absolute/path/to/TotemWorkspace/mcp/server.mjs"]
env = { TOTEM_WORKSPACE_ROOT = "/absolute/path/to/TotemWorkspace", TOTEM_REPOS_ROOT = "/absolute/path/to/workspace" }
```

Restart Codex/CodexDiscord after changing MCP configuration. In Codex TUI, `/mcp` verifies that the server is active.

The server exposes:

- `resolve_task`
- `orchestration_plan`
- `graph`
- `search`
- `context_pack`
- `impact`
- `test_plan`
- `workspace_status`
- `refresh_index`
- `summary`

`search` and `context_pack` automatically refresh relevant changed chunks before retrieval. `impact` proactively refreshes directly touched modules and then attempts to regenerate V2 graph data, so normal implementation flow updates both RAG and the detailed graph before reviewer context is built. Viewer-data errors remain separate warnings.

## Skill discovery

The repository-local skill is stored at:

```text
.agents/skills/totem-workspace-intelligence/
```

When Codex is started from TotemWorkspace, it can discover the skill directly. If CodexDiscord uses the common parent directory as its workspace cwd, expose the same skill from that parent `.agents/skills` directory (for example with a local symlink) or install it at user scope. Do not independently maintain duplicate skill text.

## Shared development lifecycle

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

The primary model uses graph retrieval before source discovery. Each delegated task
receives only selected context and compact upstream evidence.

## Incremental freshness behavior

The index does not run a filesystem watcher and does not rewrite itself on every keystroke. Instead:

1. `search` and `context_pack` check selected repositories immediately before retrieval.
2. File size/mtime, repository identity/worktree state, and SHA-256 verification detect changes.
3. Only affected chunks are rebuilt; unrelated modules stay intact.
4. Deleted files remove old chunks and newly created indexable files are added.
5. After implementation, MCP `impact` refreshes touched modules, then refreshes generated V2 data.
6. If index schema/root/knowledge shape no longer matches, one full rebuild occurs automatically.

This is lazy/proactive incremental freshness rather than a background daemon.

## Snapshot versus live source

`data/modules.json` records a validated architecture/source snapshot. A local module repository may move ahead during development.

- Live module source is authoritative for implementation details.
- TotemWorkspace remains authoritative for documented cross-module ownership and contracts until deliberately refreshed.
- Generated V2 code-detail nodes describe discovered code structure but do not promote a relationship into an architecture contract.
- Never reset newer local source merely to match the snapshot.

## Execution constraints and shared runtime

The authoritative schema-v2 contract is `intelligence/orchestration-plan.mjs`.
It returns affected modules/features/components/contracts, read/write scopes, impacted
consumers, dependency waves, parallelism and concurrent-write limits, validation,
independent-review, risk/security/release constraints and token/context hints.
Complexity scores are diagnostics and never mandate agents.

The shared `intelligence/agent-runtime/` layer owns runtime policy, model routing and
prompt instructions. Surfaces own transport and presentation. App Server capability
and model discovery determine available execution paths; unavailable models fall back
gracefully. Native IDE/CLI Codex consumes the same MCP/skill contract within its host
session rather than pretending to share a process with Bridge or Discord.

Viewer execution strips display planned waves, scopes, concurrent-write limits and
model preference. Actual lifecycle and token usage are shown only when emitted by the
runtime. `orchestration_planned` is never evidence of agent creation or Spark usage.

## Validation

Run both validators before merging intelligence/viewer changes:

```sh
node scripts/validate-workspace.mjs
node scripts/validate-intelligence.mjs
```

The intelligence validator checks 11 modules, 58 curated features, 32 contracts, representative Chinese routing, incremental index create/modify/delete behavior, MCP initialize/tools/list/resolve, generated-data determinism, source-body exclusion, and the requirement that `graph-v2.html` contain no graph data or inline graph script.

## Runtime operation and enforcement limits

Use `node scripts/totem-runtime.mjs capabilities` to inspect live runtime readiness
without a model turn. `run` accepts a task argument or stdin; `resume --thread <id>`
continues a saved thread. Optional `--model` and `--effort` are user preferences.
SIGINT cancels; the CLI declines approvals because it has no interactive approval UI.

The App Server receives graph-derived module sandbox roots and an execution cwd
inside an allowed root. In-process leases reject overlapping writes across managed
runner instances. A shared atomic filesystem lease conservatively serializes writes across independent processes using the same checkout; stale or unknown owners fail closed until the exited owner is confirmed and abandoned local state is cleaned. Dependency-wave
completion and max writes inside arbitrary agent tools are semantic obligations, not
a universal tool-level gate. Native IDE sessions inherit their own host enforcement.
Required independent review and deterministic validation still need actual evidence.

Model catalog fallback is capability-based. Usage reflects available runtime evidence;
missing subagent accounting, cached/repeated context and escalation costs must not be
reported as measured totals. No additional model calls are made for token accounting.

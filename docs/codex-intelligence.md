# Totem Workspace Intelligence

TotemWorkspace includes a repository-local Codex skill plus a dependency-aware MCP/local runtime layer. Its job is to narrow Totem work by module, feature, contract, component and risk before models read large portions of the sibling repositories.

## What it provides

- graph retrieval derived from the validated `index.html` architecture and `data/modules.json`
- Chinese/English aliases for Totem concepts
- local lexical + symbol-aware code indexing across sibling repositories
- automatic incremental freshness checks for selected modules
- task resolution, dependency neighborhood, impact analysis and test planning
- audience-specific bounded context packs
- generated Flutter graph data combining curated architecture with factual implementation evidence
- Change Intelligence, Verification Graph and Development Replay inputs
- no required embeddings, remote vector database or external graph database

The disposable local index lives under `.totem-index/` and must not be committed.

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

If the layout differs, set `TOTEM_REPOS_ROOT` to the directory containing module repositories and `TOTEM_WORKSPACE_ROOT` to the TotemWorkspace checkout.

## Build and query the code index

```sh
node scripts/totem-intelligence.mjs build-index
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

The code index uses per-file metadata, repository HEAD/branch/worktree state and SHA-256 verification. Narrowed retrieval refreshes only changed/new/deleted files in selected modules.

`build-index`, `refresh-index`, `impact` and the compatibility `render-graph` path now target the **Flutter JSON graph asset**. The retired browser JavaScript viewer and `viewer/generated/graph-data.js` are not regenerated.

## Graph data contract

`intelligence/code-graph.mjs` owns `buildGraphViewModel()`. It combines two different evidence classes:

1. **Curated architecture** — active modules, feature branches, hard dependencies, Fabric `suggests`, runtime optional contracts, EventBus relations, external services and Observer provider contracts.
2. **Generated code detail** — production-code-only package/class/symbol/surface evidence, components, implementation paths and discovered tests.

Generated code detail deliberately excludes source bodies and cannot create or redefine module contracts.

The maintained rendering path is:

```text
validated architecture + local code index
                │
                ▼
       buildGraphViewModel()
                │
       ┌────────┴────────┐
       ▼                 ▼
/api/graph-data   viewer_flutter/assets/graph-data.json
       │                 │
       └────────► Flutter Viewer
```

`scripts/render-flutter-graph.mjs` writes the persistent Flutter asset. `scripts/render-graph-v2.mjs` remains only as a compatibility entry point for existing intelligence/runtime callers and delegates to the Flutter generator; it is not a browser renderer.

## Automatic graph update flow

```text
implementation
  → impact
      → refresh touched code-index chunks
      → refresh Flutter graph data
  → test_plan
  → required review
  → Gradle / GameTest / E2E validation
```

If `search` or `context_pack` discovers an index change first, selected chunks are refreshed lazily. Graph-data generation warnings remain separate from successful impact/index results where the caller treats rendering as best-effort.

## MCP server

Example Codex configuration:

```toml
[mcp_servers.totemWorkspace]
command = "node"
args = ["/absolute/path/to/TotemWorkspace/mcp/server.mjs"]
env = { TOTEM_WORKSPACE_ROOT = "/absolute/path/to/TotemWorkspace", TOTEM_REPOS_ROOT = "/absolute/path/to/workspace" }
```

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

`search` and `context_pack` freshness-check relevant changed chunks before retrieval. `impact` refreshes directly touched modules before downstream review/test planning.

## Skill discovery

The repository-local skill is stored at:

```text
.agents/skills/totem-workspace-intelligence/
```

Do not independently maintain duplicate skill text. When Codex starts from a common parent workspace, expose the same repository skill by the supported local/user-scope mechanism rather than copying it into a divergent version.

## Shared development lifecycle

TotemWorkspace constrains work; it does not prescribe a fixed internal agent topology.

All non-trivial Totem development uses the same lifecycle from **Flutter, Discord, Bridge, CLI, IDE or a sibling repository Codex session**:

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

For the same normalized task, semantic focus and workspace state, execution constraints must remain equivalent regardless of starting surface. Respect module ownership, read/write scopes, dependency waves, maximum concurrent writes, shared-contract stabilization, impacted consumers, validation, security and release gates.

An `independentReviewRequired` constraint requires actual independent review evidence, not a particular named agent role. Read-only waves never write. Never revert unrelated work from another contributor.

Correctness comes first, total model tokens second and latency last. Prefer bounded/lightweight execution where sufficient; escalate reasoning for ambiguous shared APIs/protocols, conflicting evidence, high-risk persistence/networking or non-local failures. Model hints are preferences, not evidence of actual model usage.

## Incremental freshness

The index is not a filesystem watcher:

1. `search` and `context_pack` inspect selected repositories before retrieval.
2. file metadata/worktree state and SHA-256 checks detect changes.
3. only affected chunks are rebuilt.
4. deleted files remove stale chunks; new indexable files are added.
5. `impact` refreshes touched modules and Flutter graph data.
6. incompatible index schema/root/knowledge shape can force a full rebuild.

This is lazy/proactive incremental freshness, not a background daemon.

## Snapshot versus live source

`data/modules.json` records a validated architecture/source snapshot. A local module repository may move ahead during development.

- live module source is authoritative for implementation details
- TotemWorkspace remains authoritative for documented cross-module ownership/contracts until deliberately refreshed
- generated code-detail evidence does not promote a relationship into an architecture contract
- never reset newer local source merely to match the snapshot

## Execution constraints and shared runtime

`intelligence/orchestration-plan.mjs` returns schema-v2 affected modules/features/components/contracts, read/write scopes, impacted consumers, dependency waves, parallelism/concurrent-write limits, validation, independent-review, risk/security/release constraints and token/context hints. Complexity scores are diagnostics; they do not mandate agent count.

The shared `intelligence/agent-runtime/` layer owns runtime policy, model routing and prompt instructions. Flutter, Discord, Bridge and CLI own transport/presentation. Actual lifecycle and token/model usage are displayed only when emitted by the runtime; `orchestration_planned` is never proof that an agent was created or a specific model was used.

Use:

```sh
node scripts/totem-runtime.mjs capabilities
node scripts/totem-runtime.mjs run --read-only "inspect TotemCore Observer contract"
node scripts/totem-runtime.mjs resume --thread <thread-id> "continue"
```

The App Server receives graph-derived module sandbox roots and an execution cwd inside an allowed root. In-process leases reject overlapping writes; shared atomic filesystem leases conservatively serialize conflicting writes across independent Bridge/Discord/CLI processes. Stale or unknown owners fail closed.

## Validation

Core validation commands include:

```sh
node scripts/validate-workspace.mjs
node scripts/validate-intelligence.mjs
node scripts/validate-flutter-root.mjs
node scripts/validate-local-viewer.mjs
node scripts/validate-ai-development-viewer.mjs
node scripts/validate-semantic-lod.mjs
```

The intelligence/viewer validators now enforce that Flutter is the sole maintained viewer and that retired browser artifacts remain absent while graph semantics, MCP, incremental indexing, Local Bridge boundaries and runtime contracts continue to work.

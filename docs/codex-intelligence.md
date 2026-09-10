# Totem Workspace Intelligence

TotemWorkspace includes a repository-local Codex skill plus dependency-aware MCP/local runtime tooling. Its job is to narrow Totem work by module, Feature, contract, Component and risk before models read large portions of sibling repositories.

## Responsibilities

- graph retrieval from validated curated architecture and `data/modules.json`
- Chinese/English aliases for Totem concepts
- local lexical + symbol-aware indexing across sibling repositories
- incremental freshness checks for selected modules
- task resolution, dependency neighborhood, impact analysis and test planning
- audience-specific bounded context packs
- generated Flutter graph data combining curated architecture with factual implementation evidence
- Change Intelligence, Verification Graph and Development Replay inputs

No embedding service, remote vector database or external graph database is required. Disposable local state lives under `.totem-index/` and must not be committed.

## Expected workspace layout

```text
workspace/
├── TotemWorkspace/
├── TotemCore/
├── TotemRemnant/
├── TotemNexus/
├── TotemAutomata/
└── ...
```

Set `TOTEM_REPOS_ROOT` when sibling repositories use a different parent directory and `TOTEM_WORKSPACE_ROOT` when TotemWorkspace itself is elsewhere.

## CLI

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

`build-index`, `refresh-index`, `impact` and `render-graph` ultimately refresh the Flutter JSON graph asset. The retired browser JavaScript viewer is not regenerated.

## Graph data contract

`intelligence/code-graph.mjs` owns `buildGraphViewModel()`. It combines two evidence classes:

1. **Curated architecture** — active modules, Feature branches, dependency contracts, EventBus relations, external services and Observer providers.
2. **Generated implementation evidence** — production-code-only Components, implementation paths, symbols, shared capabilities and discovered Tests.

Generated implementation evidence deliberately excludes source bodies and cannot create or redefine curated contracts.

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

`scripts/render-flutter-graph.mjs` is the maintained persistent graph-data generator.

## Automatic refresh flow

```text
implementation
  → impact
      → refresh touched code-index chunks
      → refresh Flutter graph data
  → test_plan
  → required review
  → Gradle / GameTest / E2E validation
```

`search` and `context_pack` also freshness-check selected modules before retrieval. Graph generation remains presentation output; a graph warning must not convert successful indexing/impact/test analysis into failure.

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

The MCP `graphPreview` result describes `viewer_flutter/assets/graph-data.json`; it does not report a browser HTML artifact.

## Repository skill

The repository-local skill is stored under:

```text
.agents/skills/totem-workspace-intelligence/
```

Do not maintain independent copies of the skill text. A Codex session started from a common parent workspace should expose this same skill through the supported local/user-scope mechanism.

## Shared development lifecycle

TotemWorkspace constrains work; it does not prescribe a fixed internal agent topology.

All non-trivial Totem development uses the same lifecycle from Flutter, Discord, Bridge, CLI, IDE or a sibling-repository Codex session:

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

An `independentReviewRequired` constraint requires actual independent review evidence rather than a particular named role. Correctness comes first, total model tokens second and latency last. Prefer bounded/lightweight execution where sufficient; escalate reasoning for ambiguous shared APIs/protocols, conflicting evidence, high-risk persistence/networking or non-local failures. Model hints are preferences, not execution evidence.

## Incremental freshness

The code index is not a filesystem watcher:

1. `search` and `context_pack` inspect selected repositories before retrieval.
2. file metadata/worktree state and SHA-256 checks detect changes.
3. only affected chunks are rebuilt.
4. deleted files remove stale chunks; new indexable files are added.
5. `impact` refreshes touched modules and Flutter graph data.
6. incompatible index schema/root/knowledge shape can force a full rebuild.

This is lazy/proactive incremental freshness rather than a background daemon.

## Snapshot versus live source

`data/modules.json` records a validated architecture/source snapshot. A local module repository may move ahead during development.

- live module source is authoritative for implementation details
- TotemWorkspace remains authoritative for documented cross-module ownership/contracts until deliberately refreshed
- generated code-detail evidence does not promote a relationship into an architecture contract
- never reset newer local source merely to match the snapshot

## Execution constraints and runtime

`intelligence/orchestration-plan.mjs` returns schema-v2 affected modules/features/components/contracts, read/write scopes, impacted consumers, dependency waves, parallelism/concurrent-write limits, validation, independent-review, risk/security/release constraints and token/context hints. Complexity scores are diagnostics; they do not mandate agent count.

The shared `intelligence/agent-runtime/` layer owns runtime policy, model routing and prompt instructions. Flutter, Discord, Bridge and CLI own transport/presentation. Actual lifecycle, chosen model and token usage are displayed only when emitted by the runtime.

```sh
node scripts/totem-runtime.mjs capabilities
node scripts/totem-runtime.mjs run --read-only "inspect TotemCore Observer contract"
node scripts/totem-runtime.mjs resume --thread <thread-id> "continue"
```

Managed execution receives graph-derived module sandbox roots and an execution cwd inside an allowed root. In-process leases reject overlapping writes; shared atomic filesystem leases conservatively serialize conflicting writes across Bridge/Discord/CLI processes. Stale or unknown owners fail closed.

## Validation

Core checks include:

```sh
node scripts/validate-workspace.mjs
node scripts/validate-intelligence.mjs
node scripts/validate-flutter-root.mjs
node scripts/validate-local-viewer.mjs
node scripts/validate-ai-development-viewer.mjs
node scripts/validate-semantic-lod.mjs
```

Viewer/intelligence validation must enforce that Flutter remains the sole maintained viewer, retired browser artifacts stay absent, graph semantics remain evidence-driven, MCP metadata matches the Flutter asset and Local Bridge/runtime security boundaries remain intact.

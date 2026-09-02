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

## Recommended CodexDiscord flow

```text
Discord request
  -> resolve_task
  -> context_pack(primary)
  -> optional explorer / architect
  -> context_pack(worker, module)
  -> bounded implementation
  -> impact
       -> incremental RAG refresh
       -> generated graph-data refresh
  -> test_plan
  -> reviewer context
  -> Gradle / GameTest validation
  -> Discord result
```

The primary model should not begin by searching all 11 repositories. Graph retrieval determines the initial scope, and code retrieval stays inside selected modules unless evidence requires expansion.

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

## Validation

Run both validators before merging intelligence/viewer changes:

```sh
node scripts/validate-workspace.mjs
node scripts/validate-intelligence.mjs
```

The intelligence validator checks 11 modules, 58 curated features, 32 contracts, representative Chinese routing, incremental index create/modify/delete behavior, MCP initialize/tools/list/resolve, generated-data determinism, source-body exclusion, and the requirement that `graph-v2.html` contain no graph data or inline graph script.

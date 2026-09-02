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

The default resolver assumes the repositories are siblings:

```text
Totem/
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

The curated architecture graph itself does not need an index build; it is derived directly from the validated repository sources. Code search and generated code-detail visualization use `.totem-index/code-index.json` when present. A successful `build-index` also regenerates `graph-v2.html`.

The code index uses schema v2 per-file metadata: file size, modification time, content SHA-256, module repository HEAD/branch, and a Git worktree fingerprint. The first search after upgrading an older index performs a one-time full rebuild. After that, narrowed retrieval checks only the selected modules and replaces chunks only for changed, new, deleted, or hash-mismatched files.

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

`refresh-index` is normally unnecessary because `search` and `context` automatically freshness-check their selected modules. Keep it for explicit diagnostics or maintenance. `build-index` remains the explicit full rebuild command.

## Architecture visualization V2

`graph-v2.html` is a generated presentation artifact. It is built from the same validated `loadKnowledge()` graph used by the MCP plus the local code index; it is **not** a third manually maintained dependency graph.

The visualization has two intentionally separate knowledge levels:

1. **Curated architecture** — the 11 active modules, 58 feature branches, hard dependencies, Fabric `suggests`, runtime optional contracts, EventBus relationships, external services, and Observer provider contracts. These continue to come from the validated coordination sources.
2. **Generated code detail** — deterministic metadata for indexed code categories, real source-file paths, test files, and real symbol names. This layer does not create or redefine module contracts.

The generated code-detail layer deliberately excludes source bodies. It may expose an existing source path or symbol name, but it does not embed Java/Kotlin/JSON source contents in the HTML.

### 2D layered view

The V2 overview uses left-to-right rank hints rather than the old free-form radial layout. Normal forward edges remain monotonic. A relationship whose semantic direction must point toward an earlier visual layer is routed through a separate rail before reaching its target. This reduces Observer/EventBus/runtime compatibility lines that visually grow backward through the main tree.

Selecting a module opens a detailed left-to-right tree:

```text
module
├── curated feature
└── generated code category
    └── real file
        └── indexed symbol
```

Generated code nodes remain visually distinct from curated features. The code layer is deliberately bounded per module so increasing detail does not force the overview to render the entire source tree at once.

### 3D preview isolation

The 3D mode is a self-contained Canvas preview implemented without an external CDN or runtime dependency. It is presentation-only:

- it never feeds data back into MCP or RAG;
- it never changes dependency/contracts;
- it is not required for indexing, impact analysis, test planning, or build validation;
- failure to regenerate the V2 viewer is returned as a warning and must not make a successful code-index refresh or `impact` call fail.

This isolation is intentional: visual experimentation can evolve independently from development automation.

## Automatic graph update flow

For a normal non-trivial edit the intended lifecycle is:

```text
implementation
  -> impact
      -> refresh touched code-index chunks
      -> regenerate graph-v2.html
  -> test_plan
  -> reviewer context
  -> Gradle / GameTest validation
```

If `search` or `context_pack` discovers an index change before `impact` is called, the MCP also attempts to regenerate the V2 graph. Rendering is best-effort and never replaces live source as implementation truth.

The graph becomes more detailed as the index sees real files and symbols, but that does **not** mean the model has promoted those details into architecture facts. Only the curated architecture layer may define dependency direction, ownership, optional-contract semantics, EventBus relationships, or Observer protocol ownership.

## Register the MCP server with Codex

Add a server entry to the Codex configuration used by the same operating-system user that runs CodexDiscord. Replace the example paths with real absolute paths:

```toml
[mcp_servers.totemWorkspace]
command = "node"
args = ["/absolute/path/to/TotemWorkspace/mcp/server.mjs"]
env = { TOTEM_WORKSPACE_ROOT = "/absolute/path/to/TotemWorkspace", TOTEM_REPOS_ROOT = "/absolute/path/to/Totem" }
```

Restart Codex/CodexDiscord after changing MCP configuration. In Codex TUI, `/mcp` can be used to verify that the server is active.

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

`search` and `context_pack` automatically refresh relevant changed chunks before retrieval. `impact` proactively refreshes directly touched modules and then attempts to regenerate `graph-v2.html`, so the normal implementation flow updates both RAG and the detailed graph before reviewer context is built. `refresh_index` behaves the same way. A viewer render error is reported separately and does not convert a successful index/impact operation into a failure.

## Skill discovery

The repository-local skill is stored at:

```text
.agents/skills/totem-workspace-intelligence/
```

When Codex is started from TotemWorkspace, it can discover the skill directly. If CodexDiscord uses the common parent directory as its `workspace` cwd, expose the same skill from that parent `.agents/skills` directory (for example with a local symlink) or install/copy the skill at the user level. Do not duplicate and independently maintain the skill text in multiple repositories.

The MCP server remains usable even when the skill is not discovered; the CodexDiscord coordinator prompt should still prefer the Totem MCP tools when available.

## Recommended CodexDiscord flow

For a non-trivial Totem development request:

```text
Discord request
  -> resolve_task
  -> context_pack(primary)  [freshness-check selected modules]
  -> optional explorer / architect
  -> context_pack(worker, module)  [freshness-check worker module]
  -> bounded implementation
  -> impact
       -> proactive incremental RAG refresh
       -> best-effort graph-v2.html regeneration
  -> test_plan
  -> reviewer context  [freshness-check reviewer modules]
  -> Gradle / GameTest validation
  -> Discord result
```

The primary model should not begin by searching all 11 repositories. Graph retrieval determines the initial scope, and code retrieval is then restricted to the selected modules unless evidence requires expansion.

## Incremental freshness behavior

The index does not run a filesystem watcher and does not rewrite itself on every keystroke. Instead it uses bounded, deterministic refresh points:

1. `search` and `context_pack` check the selected module repositories immediately before retrieval.
2. Normal file edits are detected from per-file size/mtime metadata; changed repository identity/worktree state also causes SHA-256 verification of otherwise unchanged-looking files.
3. Only affected file chunks are removed and rebuilt. Unchanged chunks from that module and every unrelated module stay intact.
4. Deleted files remove their old chunks; newly created indexable files are added automatically.
5. After implementation, MCP `impact` refreshes directly touched modules before `test_plan` and reviewer work, then attempts to regenerate V2 HTML.
6. If the index is missing, still uses the old schema, moves to a different repository root, or no longer matches the current 11-module knowledge shape, one full rebuild is performed automatically.

This is lazy/proactive incremental freshness rather than a background daemon: after a source edit, the index is guaranteed to be checked at the next retrieval or normal `impact` step.

## Snapshot versus live source

`data/modules.json` records a validated architecture/source snapshot. A local module repository may move ahead of that commit during development.

Use `workspace_status` to detect this condition:

- live module source is authoritative for implementation details;
- TotemWorkspace remains authoritative for documented cross-module ownership and contracts until the coordination snapshot is deliberately updated;
- generated V2 code-detail nodes describe discovered code structure but do not promote a relationship into an architecture contract;
- never reset or overwrite a newer local branch merely to match the snapshot.

Incremental index freshness and V2 rendering do not change that source-of-truth policy. They are retrieval/presentation accelerators; final implementation decisions still use live repository source.

## Validation

Run both validators before merging changes to the intelligence layer:

```sh
node scripts/validate-workspace.mjs
node scripts/validate-intelligence.mjs
```

The second validator checks that the intelligence graph still derives 11 active modules and all 58 feature branches, preserves dependency classifications, resolves representative cross-module Chinese queries, exercises incremental indexing, verifies the MCP initialize/tools/list/resolve path, and validates that V2 graph generation is self-contained and never embeds indexed source bodies.

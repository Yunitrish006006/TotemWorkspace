# Totem Workspace Intelligence

TotemWorkspace includes a repository-local Codex skill plus a dependency-aware local MCP server. The goal is to narrow a Totem task by module, feature, contract, and risk before the primary model reads large parts of the 11 repositories.

## What V1 provides

- Graph retrieval derived from the existing `index.html` feature graph and `data/modules.json` snapshot.
- Chinese/English aliases for common Totem concepts.
- Local lexical + symbol-aware code indexing across sibling Totem repositories.
- Task resolution, dependency neighborhood, impact analysis, test planning, workspace drift checks, and audience-specific context packs.
- No embeddings, remote vector database, or external service is required.

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

The graph itself does not need an index build; it is derived directly from the validated repository sources. Only code search uses `.totem-index/code-index.json`.

Useful CLI checks:

```sh
node scripts/totem-intelligence.mjs summary
node scripts/totem-intelligence.mjs resolve "死亡背包跟 Nexus 同步有問題"
node scripts/totem-intelligence.mjs graph totem-remnant 2
node scripts/totem-intelligence.mjs context "銅魁儡背包防巢狀" primary
node scripts/totem-intelligence.mjs status
```

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

`refresh_index` writes only to `.totem-index/` and does not modify any module repository.

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
  -> context_pack(primary)
  -> optional explorer / architect
  -> context_pack(worker, module)
  -> bounded implementation
  -> impact
  -> test_plan
  -> reviewer context
  -> Gradle / GameTest validation
  -> Discord result
```

The primary model should not begin by searching all 11 repositories. Graph retrieval determines the initial scope, and code retrieval is then restricted to the selected modules unless evidence requires expansion.

## Snapshot versus live source

`data/modules.json` records a validated architecture/source snapshot. A local module repository may move ahead of that commit during development.

Use `workspace_status` to detect this condition:

- live module source is authoritative for implementation details;
- TotemWorkspace remains authoritative for documented cross-module ownership and contracts until the coordination snapshot is deliberately updated;
- never reset or overwrite a newer local branch merely to match the snapshot.

## Validation

Run both validators before merging changes to the intelligence layer:

```sh
node scripts/validate-workspace.mjs
node scripts/validate-intelligence.mjs
```

The second validator checks that the intelligence graph still derives 11 active modules and all 58 feature branches, preserves dependency classifications, and resolves representative cross-module Chinese queries correctly.

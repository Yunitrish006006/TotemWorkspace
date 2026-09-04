# TotemWorkspace AI Development Graph

## Goal

Turn the existing code-first semantic architecture graph into a local-first AI development observability surface.

The viewer should answer:

1. What is the coding agent doing now?
2. Which module / feature / component / implementation is it touching?
3. What changed after the task?
4. What is the impact radius and which tests verify it?

The graph remains derived from validated workspace knowledge and production-code evidence. AI activity is an overlay, never a new architecture source of truth.

## Surfaces that must stay in sync

TotemWorkspace currently ships two maintained viewer surfaces from the same graph data and local bridge contract:

- **Flutter production root**: GitHub Pages repository root.
- **Legacy standalone 3D**: `/legacy/`, kept as a rollback/debug surface.

Any activity, settings, prompt-gating, semantic LOD, diff, impact, or replay capability added to one maintained surface must either be implemented on both surfaces in the same change or explicitly fail parity validation.

The two surfaces may render differently, but their behavior and event semantics must stay equivalent.

## Local-first architecture

```text
GitHub Pages / localhost viewer
            |
            | approved-origin HTTP
            v
Local Agent Bridge (127.0.0.1 only)
            |
   +--------+---------+----------+
   |                  |          |
 Agent adapter       Git      Gradle/Test
   |                  |          |
   +------------------+----------+
                      |
                local Totem repos
```

The bridge is never exposed on LAN/WAN by default. It may accept browser requests only from loopback origins and explicitly approved TotemWorkspace Pages origins.

Uncommitted source, local filesystem paths, credentials and tokens must not be published into generated Pages artifacts.

## Prompt behavior

Prompt is an optional surface, not a different product mode.

- `promptEnabled = false`: no prompt box is rendered.
- `promptEnabled = true`: the prompt surface is rendered and submits to the local bridge.
- Turning Prompt off must not disable graph browsing, Agent Activity, semantic diff, impact analysis, verification state or replay.
- Published Pages remain useful when no Local Agent Bridge is connected.
- Prompt execution is adapter-driven. The bridge may accept/queue a prompt before a concrete coding-agent adapter is installed, but the UI must not claim that work started until an adapter emits activity.

## Agent activity event model

Initial event families:

- `task_started`
- `task_completed`
- `task_failed`
- `prompt_submitted`
- `feature_selected`
- `file_read`
- `file_edit`
- `symbol_read`
- `symbol_edit`
- `dependency_followed`
- `test_started`
- `test_passed`
- `test_failed`
- `relation_added`
- `relation_removed`
- `git_diff_updated`
- `commit_created`
- `pr_created`
- `pr_merged`
- `deployment_started`
- `deployment_completed`
- `deployment_failed`

Every event must have a monotonically increasing sequence number and timestamp. Optional semantic coordinates may include module, feature, component, file, symbol, relation endpoints, test target and human-readable summary.

## Progressive semantic LOD

The graph should reveal detail only when needed.

```text
L0 Workspace
L1 Module
L2 Feature
L3 Component / Responsibility
L4 Implementation (file / class)
L5 Symbol (method / field / handler)
```

Additional non-tree entities:

- API / Capability
- State
- Test
- Resource / Data
- External service

The default published view remains module → feature. Agent attention or explicit user drill-down may temporarily reveal deeper levels.

## Typed relationships

Planned edge vocabulary:

- owns
- implements
- calls
- uses-api
- reads
- writes
- persists
- renders
- publishes
- subscribes
- sends
- receives
- validated-by
- depends-on
- affected-by

Animations must encode state rather than decoration: analysis pulse, edit ring, dependency-flow motion, pass/fail feedback, added/removed relation transitions and affected-node halos.

## Change intelligence

After an agent task, compare the previous semantic graph and current graph.

Show:

- added / modified / removed graph entities,
- added / removed relations,
- affected modules/features/components,
- tests that cover the changed semantic area,
- before/after replay.

The semantic diff must be traceable back to Git/code evidence. It must not infer architecture changes solely from natural-language agent summaries.

## Repository onboarding

Adding a normal Totem module must be data-driven.

Target workflow:

1. Add the repository/module record to the workspace registry.
2. CI clones the configured active repository.
3. Production code/resource inventory runs automatically.
4. Package roots, generic surfaces and cross-module imports are inferred.
5. Graph data is regenerated.
6. Both viewer surfaces render the module.
7. Optional curated feature metadata may improve semantic naming.

Do not add `if (module.id === "...")` classifier branches merely because a repository is new. Modify the generic analyzer only when the new repository introduces a previously unsupported technical pattern.

Validation must derive active-module count from registry data rather than permanently assuming eleven modules.

## Delivery phases

### Phase 1 — Local Activity Foundation

- formal shared viewer settings contract,
- Prompt visibility toggle,
- approved Pages → loopback bridge access,
- activity event ingestion/read API,
- prompt intake API,
- activity/prompt UI on both maintained viewer surfaces,
- parity regression.

### Phase 2 — Semantic LOD

- Component candidates,
- Implementation nodes,
- attention-driven expansion,
- stable node identity across graph regeneration.

### Phase 3 — Change Intelligence

- before/after semantic snapshot,
- Git diff → semantic change mapping,
- graph change animation,
- impact highlighting.

### Phase 4 — Verification Graph

- Test entities,
- feature/API → validated-by relations,
- live test state and failure highlighting.

### Phase 5 — Agent Adapter Integration

- concrete Codex/agent adapter,
- prompt dispatch,
- task lifecycle events,
- no implicit execution when adapter is unavailable.

### Phase 6 — Development Replay

- durable local activity sessions,
- timeline scrubber,
- graph state reconstruction,
- commit/PR/deployment milestones.

## Security requirements

- Bridge bind address defaults to `127.0.0.1` and rejects non-loopback bind requests.
- Browser origin allowlist is explicit.
- API responses must not expose absolute local repo paths.
- Activity payload size and prompt size are bounded.
- Unknown settings/event types are rejected or normalized without executing arbitrary commands.
- The bridge must not execute shell commands supplied directly by browser payloads.
- Prompt UI and agent execution remain separate concerns.

## Phase 1 acceptance criteria

Phase 1 is complete when:

- both viewer surfaces use the same settings semantics,
- Prompt can be enabled/disabled without changing any other viewer behavior,
- both surfaces can observe the same local activity feed,
- a prompt can be accepted by the bridge and represented as an activity event without pretending an agent executed it,
- Pages build packages both maintained surfaces,
- Node 20/22, Flutter analyze/test/Wasm, local bridge security tests and viewer parity tests all pass.


## Remote SSH local-root parity

VS Code Remote-SSH is a first-class local-development topology. The browser always
talks to a loopback endpoint forwarded through SSH; the Bridge never needs a
public bind.

The route contract is intentionally identical in development and production:

```text
/           Flutter production UI
/legacy/    maintained JavaScript rollback/debug viewer
/api/*      Local Agent Bridge API
```

The remote controller fingerprints `viewer_flutter/` and rebuilds the local
Flutter Wasm output only when the source changes. tmux is preferred for the
background process, with nohup + PID state under `.totem-index/` as the
no-sudo fallback.


## Phase 2 — Semantic LOD implementation

Phase 2 implements the first code-aware drill-down beneath curated Features:

```text
L0 Workspace
L1 Module
L2 Feature
L3 Component / Responsibility       ✅ Phase 2
L4 Implementation (File/Class)      ✅ controlled Phase 2
L5 Symbol (Method/Field/API Symbol)  planned
```

### Component inference

Components are inferred generically from production-code-only package, class,
symbol, import, and surface evidence. Stable IDs use:

```text
component:<module-id>:<semantic-area-key>
```

No module-specific inference branches are allowed. A shared bilingual semantic
concept lexicon is permitted only for domain concepts and must remain independent
of repository identity.

### Confidence-gated Feature mapping

A Component is attached to a curated Feature only when its best semantic score is
strong enough and clearly exceeds the runner-up. Ambiguous or weak evidence is
kept as a module-level Component rather than inventing an architectural
relationship.

### Controlled implementation detail

Implementation files are not globally rendered. They appear only when their
Component is selected/expanded, or when Agent Activity targets that Component and
`autoExpandAgentFocus` is enabled. The current L4 display is capped per Component
to keep the graph legible.

Both maintained surfaces use the same progression:

```text
Module
  → Feature
    → Component
      → Implementation
```

Agent Activity focus priority is Component → Feature → Module. Symbol-level L5 is
explicitly deferred until Component responsibilities and file ownership are
stable enough to support it without graph explosion.


## Phase 3 — Change Intelligence implementation

Phase 3 uses the persisted local code index as the semantic before-state and the
refreshed code index as the after-state. This avoids treating agent prose as
architecture evidence and avoids reconstructing uncommitted source from Git.

The local refresh pipeline is:

```text
current .totem-index code index
  → before semantic snapshot
  → collect sibling-repository Git working-tree changes
  → refresh production-code index
  → after semantic snapshot
  → semantic entity/relation diff
  → Git file → Module / Feature / Component / Implementation mapping
  → existing impactAnalysis() propagation
  → .totem-index/change-intelligence.json
```

The Bridge exposes the latest result at `GET /api/change-intelligence`.
`POST /api/refresh` also returns the same change-intelligence payload and emits
a `git_diff_updated` Agent Activity event when either Git files or semantic
entities changed.

Phase 3 semantic snapshots include Module, Feature, Component, Implementation,
Test and relation identities after Phase 4. Full before/after snapshot identities
and fingerprints are persisted locally.

`affectedEntityIds` is the union of structural semantic diff IDs and
Git-to-semantic mappings, so a method-body-only edit still highlights its Module,
Feature, Component and Implementation even when the architecture shape itself did
not change.

Both maintained viewer surfaces consume the same payload:
- Flutter renders a CHANGE strip, animated changed entity/relation rings, and
  impacted-module halos.
- Legacy 3D renders the same changed IDs, relation transitions and impacted-module
  halos through the local live adapter.
- `changeAnimationsEnabled = false` disables pulsing while retaining static
  change/impact indication.

All Git paths exposed to the browser are repository-relative; absolute local paths
are never included.


## Phase 4 — Verification Graph implementation

Phase 4 separates **test evidence**, **verification requirements**, and **live
execution state** so the viewer never claims that a required check has passed
merely because it appears in policy.

### Test entities are code evidence

Test entities are derived from files actually present in the sibling repository
code index. Supported generic evidence includes unit tests, GameTests, client
tests, integration tests and E2E test source locations. Stable IDs are:

```text
test:<module-id>:<repository-relative-path>
```

No absolute local path is exposed. Test entities may carry inferred links to
Feature, Component, contract/API and shared capability targets when code/path/
symbol evidence is strong enough.

### Required verification is not passed evidence

`data/test-matrix.json` produces verification requirements and the active
verification plan. It does **not** create Test entities and it does not imply
success. The active plan combines:

```text
default requirements
  + affected / impacted module requirements
  + Phase 3 risk-derived requirements
```

This keeps statements such as `three-jvm-e2e required` distinct from
`three-jvm-e2e passed`.

### validated-by relations

The graph payload publishes typed `validated-by` relations from semantic targets
to Test entities. The initial target set is:

- Feature → Test
- contract/API → Test when the contract is feature-bound
- shared capability → Test when the capability is feature-bound

The viewers use controlled Test LOD: linked Tests appear when the owning Feature
is expanded; Tests without a reliable Feature mapping remain module-level and are
shown only when that Module is expanded.

### Live verification state

The Local Bridge records `test_started`, `test_passed` and `test_failed`
activity events into:

```text
.totem-index/verification-state.json
```

Only the latest state for the same module/test target is retained. The browser
reads `GET /api/verification-state`; it cannot execute Gradle or arbitrary shell
commands through this endpoint.

When a Test entity resolves, its live status propagates to its Test, Module,
Feature, Component, contract and capability targets. Both maintained viewers use
the same status sets:

- running: cyan pulse
- passed: green verification state
- failed: red failure halo
- `validated-by` edges inherit the active verification state

Verification polling is independent of Prompt visibility and Agent Activity
visibility. Disabling change animations does not disable verification state.

Phase 5 remains responsible for the concrete Codex/agent adapter that actually
starts test processes and emits lifecycle events.


## Phase 5 — Codex Agent Adapter implementation

Phase 5 adds a concrete local Codex CLI adapter while preserving the browser/host
security boundary.

### Explicit host opt-in

Agent execution is disabled by default:

```text
TOTEM_AGENT_ADAPTER=off
```

Only the Bridge host environment may enable Codex:

```text
TOTEM_AGENT_ADAPTER=codex
TOTEM_CODEX_BIN=codex
TOTEM_CODEX_CWD=<path inside Totem workspace>
TOTEM_CODEX_SANDBOX=workspace-write|read-only
TOTEM_CODEX_MODEL=<optional>
```

The browser Prompt request contains only the user prompt and optional semantic
Module/Feature focus. It cannot select the executable, cwd, sandbox, model, or
arbitrary CLI arguments.

### Codex execution contract

The adapter launches Codex non-interactively with structured argv and Prompt
stdin:

```text
codex exec --json --skip-git-repo-check
  --sandbox <host-configured mode>
  --cd <host-configured Totem workspace cwd>
  [--model <host-configured model>]
  -
```

The adapter intentionally does not add `--full-auto` or
`--dangerously-bypass-approvals-and-sandbox`. Authentication and approval
policy remain part of the operating-system user's Codex configuration.

### JSONL → graph activity

The adapter consumes Codex JSONL events instead of scraping terminal prose:

- process launch → `task_started`
- `thread.started` → task thread ID
- completed `file_change` → repository-relative `file_edit`
- started `mcp_tool_call` → bounded `dependency_followed`
- `turn.completed` / successful exit → `task_completed`
- `turn.failed`, stream error, spawn/process failure → `task_failed`

Absolute local file paths are mapped back to Module + repository-relative path
before entering the browser-visible activity stream.

### Dispatch and refresh lifecycle

`GET /api/agent-adapter` exposes only bounded adapter/task status. `POST
/api/prompt` always records `prompt_submitted`; it creates a Codex task only
when the adapter is configured and available. No `task_started` event is emitted
for an unavailable adapter.

Only one Codex task may run at a time. Busy dispatch returns a conflict rather than
starting an implicit second process.

After task settlement, the Bridge automatically runs the existing Phase 3 refresh
pipeline. This updates the code index, generated graph, Git→semantic mapping and
change/impact state without requiring a manual Viewer refresh.

Both maintained viewers render the same adapter lifecycle:

```text
ADAPTER OFF
CODEX UNAVAILABLE
CODEX READY
CODEX BUSY
last task failed
```

Phase 6 will make task/activity sessions durable and replayable; Phase 5 keeps the
live Codex task state in Bridge memory.

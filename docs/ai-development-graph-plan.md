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

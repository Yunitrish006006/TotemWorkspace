# Agent runtime refactor validation

Validation date: 2026-09-09. This change affects TotemWorkspace tooling and its
launch surfaces; no Minecraft module source, release version, or publication was
changed. No commit, push, or release was performed.

## Architecture and evidence

`intelligence/orchestration-plan.mjs` owns schema-v2 execution constraints.
`intelligence/agent-runtime/runtime.mjs` owns App Server execution for the Web
adapter, Discord facade, and runtime CLI. Native IDE/direct Codex sessions consume
the same contract through MCP and the repository skill; their host still owns the
model process and tools.

CLI resolve, orchestration, bounded context, impact and test-plan were executed.
Impact selected only `totem-workspace`, with `runtime-security` and independent
review required. Independent implementation reviews found and drove corrections
for retryable errors, usage wrappers, context-scope reuse, model capacity, prompt
truncation, sandbox cwd and write-lease lifecycle.

The live read-only capability probe reported Codex CLI 0.153.4, App Server,
model catalog, Astra, lightweight models, MCP and workspace intelligence available.
Six models were returned. No model turn was started by this probe. Local generated
App Server schemas were also checked; unsupported top-level environment fields
were removed. Protocol reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server).

## Deterministic validation

Commands below run from TotemWorkspace unless a working directory is stated.

| Command | Result |
| --- | --- |
| `node scripts/validate-workspace.mjs` | PASS |
| `node scripts/validate-intelligence.mjs` | PASS |
| `node scripts/validate-adaptive-orchestration.mjs` | PASS |
| `node scripts/validate-agent-adapter.mjs` | PASS |
| `node scripts/validate-model-policy.mjs` | PASS |
| `node scripts/validate-remote-bridge.mjs` | PASS |
| `node scripts/validate-ai-development-viewer.mjs` | PASS |
| `node scripts/validate-flutter-root.mjs` | PASS |
| `node scripts/validate-3d-only-parity.mjs` | PASS |
| `node scripts/validate-development-replay.mjs` | PASS |
| `node scripts/validate-change-intelligence.mjs` | PASS |
| `node scripts/validate-verification-graph.mjs` | PASS |
| `npm test` in `tools/codex-discord` | PASS; includes shared runtime and CLI fixtures |
| `flutter analyze` in `viewer_flutter` | PASS; SDK 3.47.0 |
| `flutter test` in `viewer_flutter` | PASS; 24 tests |
| `node scripts/validate-local-viewer.mjs` | FAIL on pre-existing Nexus Japanese coverage |

Sandbox restrictions initially blocked some subprocess/loopback checks; those
checks were rerun with the required permission. These were execution-environment
failures, not changed assertions or skipped correctness requirements.

## Pre-existing Local Viewer failure

TotemNexus HEAD and the working tree both have 471 source keys and 468 Japanese
translations. Its locale assets have no diff. Both versions lack:

- `container.totem.space_unit.recovery_compass`
- `book.totem.nexus_teleport_manual.page.25`
- `book.totem.nexus_teleport_manual.page.26`

The official completeness assertion remains intact. A temporary diagnostic copy
omitting only that assertion passed every remaining Local Viewer assertion,
including prompt limits, dispatch, activity, replay and served-surface checks.
This diagnostic pass does not turn the official failure into a pass.

## Remaining boundaries

- Graph-owned sandbox roots constrain managed writes. In-process leases prevent
  overlapping roots; a shared filesystem lease conservatively serializes writable
  execution across processes using the same checkout. Unknown/stale ownership
  fails closed; only confirmed exited-owner state may be cleaned manually.
- Arbitrary tools inside a Codex turn do not expose per-write wave/lease metadata.
  The deterministic execution-state API validates dependency, stabilization,
  validation and independent-review evidence when used, but cannot automatically
  intercept every shell write. Native IDE hosts must obey the shared contract.
- Independent review and actual validation remain required. A completed model
  turn is not by itself proof that the engineering lifecycle is validated.
- Usage and chosen-model telemetry represent reported runtime evidence. Missing
  subagent usage is not invented; no measured token-saving percentage is claimed.
- Model availability is discovered dynamically. Missing lightweight models use a
  capable catalog fallback; missing required reasoning capability blocks safely.
- Bridge and CLI lack Discord's interactive approval UI and decline unsupported
  approvals. The shared runtime preserves Discord approvals, images, steering,
  cancellation and App Server thread persistence.
- Existing long-lived Bridge, Discord and MCP processes must reload the changed
  implementation. Native IDE sessions continue to use their host runtime.

# Agent runtime refactor validation

Validation date: 2026-09-09. This is a point-in-time validation record for the shared runtime refactor. It is historical evidence, not the current operating specification.

The change affected TotemWorkspace tooling and launch surfaces; no Minecraft module source, release version or publication was changed.

## Architecture and evidence at validation time

`intelligence/orchestration-plan.mjs` owned schema-v2 execution constraints. `intelligence/agent-runtime/runtime.mjs` owned App Server execution for managed surfaces, while native IDE/direct Codex sessions consumed the same contract through MCP and the repository skill.

CLI resolve, orchestration, bounded context, impact and test-plan checks were executed. Impact selected only `totem-workspace`, with `runtime-security` and independent review required. Review drove corrections for retryable errors, usage wrappers, context-scope reuse, model capacity, prompt truncation, sandbox cwd and write-lease lifecycle.

The read-only capability probe reported Codex CLI 0.153.4, App Server, model catalog, Astra, lightweight models, MCP and workspace intelligence available. No model turn was started by the probe.

## Deterministic validation recorded on 2026-09-09

At the time of this record, the following checks were reported as passing:

- `node scripts/validate-workspace.mjs`
- `node scripts/validate-intelligence.mjs`
- `node scripts/validate-adaptive-orchestration.mjs`
- `node scripts/validate-agent-adapter.mjs`
- `node scripts/validate-model-policy.mjs`
- `node scripts/validate-remote-bridge.mjs`
- `node scripts/validate-ai-development-viewer.mjs`
- `node scripts/validate-flutter-root.mjs`
- `node scripts/validate-3d-only-parity.mjs` (later retired with the browser JavaScript viewer)
- `node scripts/validate-development-replay.mjs`
- `node scripts/validate-change-intelligence.mjs`
- `node scripts/validate-verification-graph.mjs`
- `npm test` in `tools/codex-discord`
- `flutter analyze` in `viewer_flutter`
- `flutter test` in `viewer_flutter`

`node scripts/validate-local-viewer.mjs` was recorded as failing at that time on pre-existing TotemNexus Japanese locale coverage. This historical failure does not describe the current branch state; use current CI for current validation status.

## Boundaries recorded by the refactor

- Graph-owned sandbox roots constrain managed writes.
- In-process leases reject overlapping roots; shared filesystem leases conservatively serialize writable execution across processes sharing a checkout.
- Unknown/stale lease ownership fails closed until the exited owner is confirmed.
- Independent review and actual validation remain required; a completed model turn is not proof of engineering validation.
- Usage and chosen-model telemetry represent actual runtime evidence only; missing subagent usage is not invented.
- Model availability is discovered dynamically and required reasoning capability fails closed when unavailable.
- Unsupported approval transports are declined rather than bypassed.

For current architecture, viewer/runtime behavior and validation commands, use `AGENTS.md`, `docs/codex-intelligence.md`, `docs/ai-development-graph-plan.md` and current GitHub Actions.

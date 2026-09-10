# TotemWorkspace agent instructions

TotemWorkspace is the public coordination, architecture-knowledge and development-control repository for the active Totem Minecraft/Fabric modules. It is not itself a Minecraft mod.

## Repository invariants

- Keep `data/modules.json`, curated architecture in `index.html`, relationship audit data and Markdown catalogs consistent.
- Derive versions, branches, commit SHAs, Fabric dependency ranges and provider protocols from the owning repositories; never infer release or CI state.
- The current audited baseline contains 11 active Totem modules, but the registry is
  extensible. Normal module onboarding must be data-driven and must not require module-specific analyzer or viewer code.
- DeadRecall is stopped-maintenance compatibility history and must not be represented as an active module or dependency.
- Classify hard Core dependencies, Fabric `suggests`, runtime optional compatibility, external services, EventBus relationships and Observer providers separately.
- Never commit JARs, build output, `.totem-index/`, credentials, tokens, private endpoints or host-specific absolute paths.

## Java 25 and release gate

- Verify the owning repository's actual Minecraft version, Fabric Loader/API and mappings. Use its Gradle wrapper, preserve dedicated-server safety and inspect consumers before changing shared APIs.
- **Java 25 is mandatory** for every Gradle, compile, test, GameTest, runtime probe, remap, and release operation in an active Totem module. Before the first Gradle command, select JDK 25 through `JAVA_HOME` and verify both `java -version` and `./gradlew -version` report JVM 25.
- When a module release is explicitly authorized, record a new version; run real Java-25 build/tests; inspect the remapped artifact; commit and push the exact source/version change; confirm required GitHub Actions checks; then use that module's owned Modrinth publish workflow and verify the published version by API read-back, including project/version compatibility, primary JAR and SHA-512.
- Keep source commit, remote CI result, Modrinth version and any publication marker consistent. Update the TotemWorkspace snapshot only from verified release evidence.
- Public release is an external action. Do not infer authorization from an edit-only request, and do not report a release complete while push, CI, publication or read-back verification is pending.

## Workspace intelligence

- `data/modules.json`, audited contracts and curated `index.html` data define the documented cross-module snapshot.
- `data/aliases.json` may extend retrieval vocabulary but must not redefine ownership or dependency direction.
- `data/test-matrix.json` defines required validation categories; it does not prove that tests passed and must not invent Gradle tasks.
- Live sibling-repository source is authoritative for implementation details when newer than the recorded snapshot. The snapshot remains authoritative for documented cross-module contracts until deliberately refreshed.
- `.totem-index/` is disposable local RAG/runtime state and is never canonical evidence.

## Execution contract

TotemWorkspace constrains the work. It does not prescribe the internal agent topology.
All non-trivial Totem development follows:

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

Active entry surfaces are Flutter, Discord, Bridge, CLI, IDE and sibling-repository Codex sessions. For migration-history compatibility, older validation text may still quote `from Web, Flutter, legacy Viewer, Discord, Bridge, CLI, IDE, or sibling repository Codex`; the legacy Viewer itself is retired and must not be restored.

The same normalized task, semantic focus and workspace state must yield equivalent constraints. Respect module ownership, read/write scopes, dependency waves, max concurrent writes, shared-contract stabilization, impacted consumers, required validation, security and release gates.

An `independentReviewRequired` constraint requires actual independent review evidence, not a particular named agent role. Read-only waves never write. Never revert unrelated work from another contributor.

Correctness comes first, total model tokens second and latency last. Reuse bounded context and compact findings. Prefer lightweight execution when sufficient; escalate reasoning for ambiguous shared API/protocol design, conflicting evidence, high-risk persistence/networking or non-local failures. Model hints are preferences; only runtime evidence establishes actual lifecycle, selected models, usage and validation outcomes.

## Viewer and graph rules

- Flutter Web/Wasm under `viewer_flutter/` is the only maintained viewer surface.
- `intelligence/code-graph.mjs` owns `buildGraphViewModel()`.
- `scripts/render-flutter-graph.mjs` writes `viewer_flutter/assets/graph-data.json` from validated workspace knowledge plus factual local index metadata.
- The retired browser JavaScript viewer, `graph-v2.html`, `/legacy/`, `viewer/` browser assets and `viewer/generated/graph-data.js` must not be recreated.
- Generated detail may include repository-relative source paths, deterministic components/categories, tests and symbol names. It must not contain source bodies or infer new dependency contracts.
- Curated contracts and generated implementation evidence are separate evidence classes.
- Prompt visibility is a viewer setting only. Disabling Prompt must not disable Agent Activity, graph/diff/impact/verification/replay behavior.
- Graph-data generation is presentation output. A generation warning must not convert a successful RAG refresh, impact analysis, test plan, build or test into a failure.

## Local Bridge and remote development

- Remote development is a first-class VS Code Remote-SSH use case.
- The supported default Bridge endpoint is `127.0.0.1:18765`; keep Flutter, CLI helpers, SSH documentation and remote tooling synchronized when changing it.
- `/` is the Flutter UI and `/api/*` is the loopback API. No legacy viewer route is maintained.
- `tools/remote/bridge.sh` owns Bridge background lifecycle, preferring tmux and falling back to nohup without sudo. Never bind the Bridge to `0.0.0.0` by default.
- Browser origins are explicitly allowlisted. Browser-facing API payloads must not expose absolute repository paths, credentials or tokens.
- Browser Prompt payloads cannot choose executable, cwd, sandbox, model or arbitrary CLI flags; host/runtime policy owns execution.
- Runtime logs, replay, write leases and local settings stay under ignored `.totem-index/` state.

## Observer and semantic rules

- The module owning a production Screen also owns its Observer provider and module-present coverage. TotemVanillaTweaks relays semantic snapshots and retains module-absent unsupported-metadata coverage.
- Observer paths remain read-only, monotonic, privacy-redacted and framebuffer-free. Do not introduce screenshot, framebuffer or video transmission as an implementation path.
- Semantic Component inference must remain generic and production-code-only. Do not add module-ID-specific mapping branches to force a Component onto a curated Feature.
- Feature-to-Component links are confidence-gated; ambiguous evidence stays module-level rather than inventing a relationship.
- Implementation and Test entities are progressive detail and should appear only under relevant semantic expansion/focus.

## Required repository validation

For changes affecting workspace knowledge, graph data, aliases, retrieval, MCP, viewer or runtime behavior, run the relevant Node validators and Flutter validation. At minimum preserve:

```sh
node scripts/validate-workspace.mjs
node scripts/validate-intelligence.mjs
node scripts/validate-flutter-root.mjs
node scripts/validate-local-viewer.mjs
node scripts/validate-ai-development-viewer.mjs
node scripts/validate-semantic-lod.mjs
```

Use the repository-local `totem-workspace-intelligence` skill for retrieval and lifecycle details.

# TotemWorkspace agent instructions

This repository is the public coordination and documentation source of truth for
the 11 active Totem repositories. It is not a Minecraft mod.

## Update rules

- Keep `data/modules.json`, the Markdown catalogs, and curated `index.html`
  consistent.
- Derive versions, branches, commit SHAs, Fabric dependency ranges, and provider
  protocols from the owning repositories; never infer release or CI state.
- The current audited baseline contains 11 active Totem modules, but the registry is
  extensible. Adding a normal active Totem repository must be data-driven and must
  not require module-specific analyzer or viewer code. DeadRecall is
  stopped-maintenance legacy compatibility and must not be represented as an active
  module or dependency.
- Classify Fabric `suggests`, runtime compatibility, external services, and
  EventBus subscriptions separately. An EventBus publisher does not depend on an
  optional subscriber.
- Never add JARs, build output, credentials, tokens, private endpoints, or local
  machine paths.
- Run both `node scripts/validate-workspace.mjs` and
  `node scripts/validate-intelligence.mjs` before committing changes that affect
  workspace knowledge, graph data, aliases, retrieval behavior, or V2 rendering.

## Java 25 and module release gate

- Verify actual repository Minecraft version, Fabric Loader/API and mappings; use
  the repository Gradle wrapper, isolate client-only classes, preserve dedicated-server
  safety, and inspect all consumers before changing a shared API. Keep feature logic
  in its owning module rather than moving it into Core.

- **Java 25 is mandatory** for every Gradle, compile, test, GameTest, runtime
  probe, remap, and release operation in an active Totem module. Before the
  first Gradle command, select a JDK 25 through `JAVA_HOME` and verify both
  `java -version` and `./gradlew -version` report JVM 25. Never silently fall
  back to the system JDK or downgrade to Java 21/17 because a command happens
  to start.
- When a module release is explicitly authorized, treat it as incomplete until
  its verified release sequence is finished. The sequence is: choose and record a new
  module version; run the module's real Java-25 build and applicable tests;
  inspect the remapped artifact; commit and push the exact source/version
  change to the module's default GitHub branch; confirm the required GitHub
  Actions checks are green; then use that module's owned Modrinth publish
  workflow and verify the published version by API read-back (including
  project, version, loader/Minecraft compatibility, primary JAR and SHA-512).
- Keep the source commit, remote CI result, Modrinth version and any
  `modrinth-published-<version>.json` marker consistent. Pull any workflow
  marker back to the local branch and push it when the owning workflow does
  not already do so. Update the TotemWorkspace snapshot only from this
  verified release evidence; never infer publication from a version number,
  a successful build, or a workflow trigger.
- Public release is an external action: do not infer it from an edit-only
  request. Once the requester has authorized a module release, do not report
  the update as complete while GitHub push, CI, Modrinth publication or
  read-back verification is still pending. If access, credentials, a required
  version decision, or the owned release workflow is unavailable, report that
  exact blocker instead of claiming a release.

## Workspace intelligence rules

- The Codex intelligence graph must be derived from the existing validated
  `index.html` and `data/modules.json`; do not hand-maintain a third independent
  dependency graph.
- `data/aliases.json` may add retrieval vocabulary but must not redefine module
  ownership or dependency direction.
- `data/test-matrix.json` describes validation categories and risk routing; it
  must not invent Gradle tasks that are not present in owning repositories.
- `.totem-index/` is disposable local RAG state. Never commit, document as
  canonical evidence, or manually edit it as a source of truth.
- Live sibling-repository source wins for implementation details when it is
  newer than the recorded snapshot. The workspace snapshot still defines the
  documented cross-module contract until deliberately refreshed.

## Execution contract

TotemWorkspace constrains the work. It does not prescribe the internal agent topology.
All non-trivial Totem development uses the same resolve_task -> orchestration_plan ->
bounded context -> implementation -> impact -> test_plan -> actual validation lifecycle,
from Web, Flutter, legacy Viewer, Discord, Bridge, CLI, IDE, or sibling repository Codex.
The same normalized task, semantic focus and workspace state must yield equivalent constraints.
Astra chooses direct work, delegation, specialization, scheduling and independent review.
Respect module ownership, read/write scopes, dependency waves, max concurrent writes,
shared-contract stabilization, impacted consumers, required validation, security and release gates.
An independentReviewRequired constraint requires actual independent review evidence, not a
particular agent role. Read-only waves never write. Never revert another contributor's work.
Prefer lightweight/Spark-capable available models for bounded discovery, implementation,
mechanical changes, tests and compact review when this reduces total task tokens.
Correctness comes first, total model tokens second, latency last. Reuse compact findings
and bounded context; prefer sequential work when it avoids repeated context. Escalate to
Astra reasoning for ambiguity, shared API/protocol design, conflicting evidence, high-risk
persistence/networking or non-local failures; supply compact evidence before escalation.
Model hints express preferences, not actual model usage. Only runtime evidence establishes
agent lifecycle, chosen models, usage or validation outcomes.

Use the repository-local intelligence skill for retrieval and lifecycle details.

## V2 viewer isolation rules

- `graph-v2.html` is a static renderer shell and must contain no module, feature,
  contract, file, symbol, or code-index data. Do not embed a JSON snapshot or an
  inline graph-data script in the HTML.
- `viewer/graph-v2.css`, `viewer/graph-v2-adapter.js`, and
  `viewer/graph-v2.js` are presentation code. Normal workspace/code updates must
  not rewrite them.
- `viewer/generated/graph-data.js` is the only generated V2 data artifact. It is
  produced by `scripts/render-graph-v2.mjs` from validated workspace knowledge
  plus factual local index metadata. Do not hand-edit it.
- Generated code detail may contain only factual indexed metadata such as
  relative source paths, test files, deterministic categories, and symbol names.
  It must not contain source bodies or infer new dependency contracts.
- Both maintained Pages viewer surfaces (Flutter production root and `/legacy/`)
  must stay behaviorally synchronized for settings, local activity, semantic
  relationships, diff/impact and replay capabilities. Parity must be regression-tested.
- Prompt visibility is a local viewer setting only. Disabling Prompt must not disable
  Agent Activity or any graph/diff/impact/replay capability.
- Normal MCP/CLI `impact` and index-refresh paths may regenerate only the V2 data
  artifact after source changes. Generation is best-effort: viewer-data failure
  must never turn a successful RAG refresh, impact analysis, test plan, build, or
  test into a failure.

## Observer and visual rules

- The module that owns a production Screen also owns its Observer provider and
  module-present coverage. TotemVanillaTweaks only relays the semantic snapshot
  and retains module-absent unsupported-metadata coverage.
- Observer paths remain read-only, monotonic, privacy-redacted, and entirely
  framebuffer-free. Never document or introduce screenshot, framebuffer, or
  video transmission as an implementation path.
- Preserve the curated self-contained graph and its embedded canonical module
  icons until V2 is deliberately promoted to the primary viewer.
- V2 2D overview routing should be layered and predominantly left-to-right;
  unavoidable reverse semantic edges should use separate rails instead of
  cutting back through the main dependency tree.
- V2 3D is presentation-only. It reads the same generated view model, must not
  become a source of truth, and must not be required by MCP, RAG, validation, or
  CI correctness.
- Visual changes must follow the workspace Totem art-direction rules and be
  checked at desktop and mobile sizes.

## Remote development bridge rules

- Remote development is a first-class VS Code Remote-SSH use case.
- The supported default Bridge endpoint is `127.0.0.1:18765`; keep Flutter,
  legacy Pages, CLI helpers, SSH documentation, and remote tooling synchronized
  when changing it.
- `tools/remote/bridge.sh` owns the remote Bridge background lifecycle using
  tmux when available and nohup as the no-sudo fallback. Keep it loopback-only
  and never change it to bind `0.0.0.0`.
- The local/remote Bridge route contract mirrors Pages: `/` is Flutter,
  `/legacy/` is the maintained JavaScript rollback/debug surface, and
  `/api/*` is the loopback API.
- Remote Bridge logs and runtime state belong under ignored `.totem-index/`;
  never commit host-specific paths, credentials, passwords, SSH keys, or tmux
  runtime state.
- VS Code tasks may invoke repository tooling, but must not embed host passwords
  or private SSH configuration.

- Semantic LOD Component inference must stay generic and production-code-only.
  Never add module-ID-specific mapping branches to make a particular Component
  attach to a curated Feature.
- Feature-to-Component links are confidence-gated. Ambiguous evidence must
  remain module-level instead of inventing a relationship.
- L4 implementation nodes are progressive detail: render them only beneath an
  expanded/active Component, not globally.

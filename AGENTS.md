# TotemWorkspace agent instructions

This repository is the public coordination and documentation source of truth for
the 11 active Totem repositories. It is not a Minecraft mod.

## Update rules

- Keep `data/modules.json`, the Markdown catalogs, and curated `index.html`
  consistent.
- Derive versions, branches, commit SHAs, Fabric dependency ranges, and provider
  protocols from the owning repositories; never infer release or CI state.
- Keep exactly 11 active Totem modules. DeadRecall is stopped-maintenance legacy
  compatibility and must not be represented as an active module or dependency.
- Classify Fabric `suggests`, runtime compatibility, external services, and
  EventBus subscriptions separately. An EventBus publisher does not depend on an
  optional subscriber.
- Never add JARs, build output, credentials, tokens, private endpoints, or local
  machine paths.
- Run both `node scripts/validate-workspace.mjs` and
  `node scripts/validate-intelligence.mjs` before committing changes that affect
  workspace knowledge, graph data, aliases, retrieval behavior, or V2 rendering.

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

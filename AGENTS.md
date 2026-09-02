# TotemWorkspace agent instructions

This repository is the public coordination and documentation source of truth for
the 11 active Totem repositories. It is not a Minecraft mod.

## Update rules

- Keep `data/modules.json`, the Markdown catalogs, and `index.html` consistent.
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
  workspace knowledge, graph data, aliases, or retrieval behavior.

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

## Observer and visual rules

- The module that owns a production Screen also owns its Observer provider and
  module-present coverage. TotemVanillaTweaks only relays the semantic snapshot
  and retains module-absent unsupported-metadata coverage.
- Observer paths remain read-only, monotonic, privacy-redacted, and entirely
  framebuffer-free. Never document or introduce screenshot, framebuffer, or
  video transmission as an implementation path.
- Preserve the self-contained graph and its embedded canonical module icons.
  Visual changes must follow the workspace Totem art-direction rules and be
  checked at desktop and mobile sizes.

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
- Run `node scripts/validate-workspace.mjs` before committing.

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

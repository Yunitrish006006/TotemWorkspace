# Observer subsystem extraction

On 2026-09-11, Observer View ownership was moved out of TotemVanillaTweaks into the dedicated TotemObserver module.

- TotemCore owns the versioned Observer provider/contracts only.
- TotemObserver owns `/observeui`, server-authoritative sessions, Spectator camera orchestration, semantic transport, vanilla Screen adapters, privacy/redaction, fallback metadata, cross-module runtime validation and the Dedicated Server + Target Client + Observer Client E2E.
- Feature modules own capture/reconstruction for their production Screens through `ObserverScreenProvider`.
- TotemVanillaTweaks 0.1.28 is gameplay-only and no longer contains Observer runtime code.
- TotemObserver 0.1.0 intentionally breaks TotemVanillaTweaks <=0.1.27 to prevent duplicate Observer runtime registration during the migration.

The provider negotiation path is module-agnostic: adding a new module-owned Observer Screen should require the owning module to add its provider, without adding a family-specific switch or capability bit to TotemObserver.

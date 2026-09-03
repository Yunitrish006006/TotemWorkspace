# TotemWorkspace relationship audit — 2026-09-03

This audit reviews all 32 curated contracts against the active Totem repositories and qualifies which relationships may safely retarget from module nodes to feature nodes.

## Canonical source

The machine-readable source of truth for audited relationship corrections is `data/relationship-audit.json`.

`intelligence/workspace-knowledge.mjs` loads the repository snapshot and legacy `index.html` feature descriptions, then applies the canonical audit **before** building the feature and contract records used by MCP, RAG, graph traversal, impact analysis, test planning, and V2 generation. The V2 page therefore receives already-correct contract data and does not apply a browser-time relationship patch.

The legacy `index.html` remains a historical/interactive snapshot and a source for curated feature descriptions. Its older relationship hints are not authoritative when an audited override exists.

## Rules

- A **hard dependency** remains a hard module dependency. When production evidence identifies a specific Core API seam, V2 may retarget that same hard contract to audited feature endpoints while modules are expanded; this does not create a new dependency contract.
- Shared Core facilities such as Manual may be represented separately as generated shared capabilities when they are not themselves the reason for a specific curated hard-dependency endpoint.
- A **feature endpoint** is used only when current production code/spec evidence supports that functional relationship.
- A metadata declaration such as Fabric `suggests` is still a valid module-level relationship even when an active feature bridge cannot be verified.
- Runtime Observer relay contracts and provider registration contracts are both retained as architecture facts; feature-level visualization should avoid presenting them as two independent gameplay integrations.

## 10 hard Core dependencies — verified

All ten non-Core active Totem modules retain a hard dependency on TotemCore in their Fabric metadata. Eight stay module-level only. Two have verified Core Friendship API seams and therefore carry audited feature endpoints for expanded V2 visualization while remaining `hard-core` contracts.

1. `hard:totem-alchemy:totem-core` — valid, module-level.
2. `hard:totem-enchanting:totem-core` — valid, module-level.
3. `hard:totem-discord-bridge:totem-core` — valid, module-level.
4. `hard:totem-automata:totem-core` — valid, module-level.
5. `hard:totem-vanilla-tweaks:totem-core` — valid, module-level.
6. `hard:totem-excavation:totem-core` — valid, module-level.
7. `hard:totem-villagers:totem-core` — valid, module-level.
8. `hard:totem-locksmith:totem-core` — valid; audited endpoints: Locksmith `存取控制` → Core `Friendship`. `LocksmithAccessService` uses `TotemFriendshipApi` as the server-authoritative friendship source for friendship-based access decisions.
9. `hard:totem-nexus:totem-core` — valid; audited endpoints: Nexus `好友與玩家目標` → Core `Friendship`. `NexusFriendSavedData` and `NexusFriendshipApi` delegate relationship state and mutual-friend checks to `TotemFriendshipApi`.
10. `hard:totem-remnant:totem-core` — valid, module-level.

These two Friendship mappings qualify existing hard dependency endpoints only. The contract count remains unchanged.

## 3 Fabric suggests

### `automata-excavation` — valid contract, feature mapping corrected

Verified production boundary: Automata recognizes the seven Excavation hammer item IDs for Copper Golem gathering. The selected-area integration belongs to gathering / area excavation, not combat.

Audited feature endpoints:
- Automata `採集模式`
- Excavation `雙角選區`
- Excavation `範圍挖掘`

Removed incorrect endpoint:
- Excavation `戰鬥定位`

### `villagers-remnant` — valid contract, feature mapping expanded

Toolsmith work orders, workshop completion, merchant offers and pricing participate in four-tier Remnant backpack production/sales.

Audited feature endpoints:
- Villagers `實體村莊經濟`
- Villagers `專職與工作區`
- Remnant `四階背包`

### `remnant-trinkets` — valid metadata relation, feature retargeting removed

Current Remnant Fabric metadata still declares `trinkets_updated` as a suggestion. During this audit, active production source evidence for the previously documented Trinkets inventory/death bridge was not located. The canonical graph therefore keeps this as a module-level metadata relationship and does not claim a verified `死亡背包` feature integration.

## 8 runtime optional contracts

### `automata-remnant` — valid

Audited endpoints:
- Automata `分類模式`
- Remnant `四階背包`
- Remnant `可攜容器安全`

The optional container-safety bridge applies Remnant backpack/portable-container anti-nesting policy during sorting and movement.

### `automata-locksmith` — valid

Audited endpoints:
- Automata `分類模式`
- Automata `熔爐路由`
- Automata `採集模式`
- Locksmith `網路拓撲`
- Locksmith `存取控制`
- Locksmith `自動化控制`

This is a broad authorization seam because binding/transfer/gathering must respect Locksmith ownership and automation boundaries.

### `remnant-nexus` — valid

Audited endpoints:
- Remnant `死亡背包`
- Nexus `死亡節點`

Nexus consumes the Core death-backpack lifecycle and maintains/removes the corresponding death node without a direct Remnant class dependency.

### `vanilla-automata-observer` — valid

Audited endpoints:
- VanillaTweaks `Observer View`
- Automata `Observer`

### `vanilla-nexus-observer` — valid, stale protocol/feature scope corrected

The active `NexusObserverScreenProvider` reports protocol **3**, not 2, and exposes `compass`, `map`, `management`, legacy map, friends and registration variants. Death-node admin has its own provider and must not be folded into the generic Nexus relay.

Audited endpoints:
- VanillaTweaks `Observer View`
- Nexus `磁石節點`
- Nexus `傳送地圖`
- Nexus `傳送陣診斷`
- Nexus `好友與玩家目標`

Removed from generic relay:
- Nexus `死亡節點`

### `vanilla-locksmith-observer` — valid

Audited endpoints:
- VanillaTweaks `Observer View`
- Locksmith `管理與 Observer`

### `vanilla-villagers-observer` — valid

Audited endpoints:
- VanillaTweaks `Observer View`
- Villagers `Woodcutter`

### `vanilla-remnant-observer` — valid, closest current curated endpoint

Audited endpoints:
- VanillaTweaks `Observer View`
- Remnant `物品欄側欄`

The production provider rebuilds a read-only Remnant backpack screen. The current 58-feature vocabulary has no standalone `背包 GUI / Observer` feature, so `物品欄側欄` is retained as the closest existing UI-owned feature rather than inventing a new feature during this audit.

## 2 external services

### `discord-worker` — valid

Audited endpoints:
- DiscordBridge `聊天與事件`
- DiscordBridge `伺服器狀態`
- DiscordBridge `遊戲內設定`
- DiscordBridge `安全邊界`

`DiscordTransportService` uses Worker URL/API key/channel configuration and transports bridge traffic through the external Worker. Translation remains local and is intentionally not linked.

### `automata-openai` — valid, feature mapping expanded

Audited endpoints:
- Automata `分類模式`
- Automata `採集模式`
- Automata `選配 LLM`

Gathering has its own LLM prompt/state/decision path in addition to sorting/classification.

## 3 EventBus contracts

### `event-remnant-death` — contract valid; implementation evidence qualified

Audited endpoints:
- Remnant `死亡背包`
- DiscordBridge `聊天與事件`

Core explicitly defines `DeathBackpackCreatedEvent` as published after Remnant commits a death backpack and defines recovery lifecycle semantics. Current Remnant repository code search did not independently locate the publisher call during this audit, so the canonical contract records `implementationStatus: contract-defined` rather than claiming freshly verified publisher evidence.

### `event-nexus-audit` — valid, feature mapping expanded

Audited endpoints:
- Nexus `磁石節點`
- Nexus `死亡節點`
- DiscordBridge `聊天與事件`

Nexus publishes public Space Unit updates as well as death/admin audit events.

### `event-locksmith-break` — valid

Audited endpoints:
- Locksmith `破壞稽核`
- DiscordBridge `聊天與事件`

## 6 Observer provider contracts

Provider registration contracts remain explicit architecture facts and are kept separate from the five runtime relay contracts above. The live knowledge graph uses the full provider ID form generated by `workspace-knowledge.mjs`.

1. `observer:totem-automata:automata_copper_golem@1` — valid.
2. `observer:totem-locksmith:locksmith_management@1` — valid.
3. `observer:totem-nexus:nexus@3` — **corrected from protocol 2**; active provider reports protocol 3 and eight variants.
4. `observer:totem-nexus:nexus_death_node_admin@1` — valid; owns death-node administration semantics separately from generic Nexus Observer.
5. `observer:totem-remnant:remnant_backpack@1` — valid.
6. `observer:totem-villagers:villagers_woodcutter@1` — valid.

## Shared Manual capability — not part of the 32 contracts

TotemCore provides the shared Manual Registry/assembler/renderer APIs. V2 derives `Shared Totem Manual` capability evidence from current production `src/main` / `src/client` manual implementation paths at deployment time. Tests/GameTests do not count as evidence. This preserves the dependency contract count while showing the actual shared capability relationship.

## Audit outcome

- 32/32 contracts reviewed.
- 10 hard dependencies remain `hard-core`; 8 are module-level only and 2 have verified Friendship feature endpoints (`Nexus → Core`, `Locksmith → Core`).
- 4 non-hard feature mappings required correction/expansion: `automata-excavation`, `villagers-remnant`, `automata-openai`, `event-nexus-audit`.
- 1 generic Observer mapping required scope correction: `vanilla-nexus-observer`.
- 1 provider protocol was stale: Nexus `2 -> 3`.
- 1 Fabric suggestion is retained metadata-only pending current production bridge evidence: `remnant-trinkets`.
- 1 EventBus implementation is marked contract-defined because the current publisher call was not independently located: `event-remnant-death`.
- No new dependency contracts were added.
- Audited relationship data is consumed by workspace intelligence directly; V2 no longer needs a browser-time correction layer.

# TotemWorkspace

TotemWorkspace 是現役 Totem Minecraft 模組的公開協作、架構知識與開發控制平面。這個 repository 本身不是 Minecraft 模組；它集中保存模組快照、跨模組契約、Workspace Intelligence、Local Bridge／Agent Runtime、驗證規則與 Flutter 架構 Viewer。

目前正式模組快照為 **2026-09-02**：Minecraft 26.2、Java 25、11 個現役 Totem 模組。模組發布快照與 TotemWorkspace tooling 開發是不同時間軸；tooling 的最新狀態以目前 branch／`main` 與 CI 為準。

[GitHub Pages Flutter Viewer](https://yunitrish006006.github.io/TotemWorkspace/)
｜[文件索引](docs/README.md)
｜[目前模組快照](docs/current-status.md)
｜[Workspace Intelligence](docs/codex-intelligence.md)

**Flutter Web/Wasm 是唯一維護中的 Viewer。** 舊 browser JavaScript viewer、`graph-v2.html`、`/legacy/` 與 `viewer/generated/graph-data.js` 已退休，不應重新建立。

![Totem 模組功能與依賴圖預覽](docs/images/dependency-graph.png)

## Repository map

```text
TotemWorkspace/
├── data/                       recorded machine-readable workspace snapshot/audits
├── docs/                       maintained docs + dated audit evidence
├── intelligence/               graph, indexing, change/verification/replay/runtime logic
│   └── agent-runtime/          shared Codex runtime policy and execution layer
├── mcp/                        TotemWorkspace MCP server
├── scripts/                    CLI, generators, Local Bridge and validators
├── tools/
│   ├── codex-discord/          Discord development surface
│   └── remote/                 Remote-SSH/tmux/nohup Bridge tooling
├── viewer_flutter/             sole maintained Viewer
├── .agents/skills/             repository-local TotemWorkspace skill
├── .github/workflows/          validation, inventory, Flutter and Pages CI
├── index.html                  validated curated architecture source
└── AGENTS.md                   repository-wide agent/development invariants
```

`index.html` 目前仍是 curated architecture 的資料來源之一，不是 production Pages frontend。Pages root 由 Flutter build 擁有。

## Source-of-truth hierarchy

不同資料不能互相取代：

1. **Owning Totem repository**：live implementation detail。
2. **`data/*.json` + curated `index.html`**：已記錄的跨模組 architecture snapshot／contract。
3. **Maintained docs**：開發、發布、runtime 與操作規則。
4. **Generated graph/index/replay state**：衍生 evidence，不是架構 authority。

因此：

```text
Curated contract
    ≠ inferred implementation evidence

Required verification
    ≠ passed verification evidence

Planned orchestration/model hint
    ≠ actual runtime activity/model usage
```

## Graph data flow

```text
Curated architecture (index.html + data/*.json)
                    +
       local production-code index
                    │
                    ▼
          buildGraphViewModel()
                    │
          ┌─────────┴─────────┐
          │                   │
          ▼                   ▼
/api/graph-data      viewer_flutter/assets/graph-data.json
 Local Bridge                 │
          │                   ▼
          └──────────────► Flutter Viewer
```

Generated implementation detail may add factual file/symbol/Component/Test evidence, but cannot create or rewrite dependency contracts.

## Workspace Intelligence

常用指令：

```sh
node scripts/totem-intelligence.mjs resolve "死亡背包跟 Nexus 同步有問題"
node scripts/totem-intelligence.mjs orchestrate "死亡背包跟 Nexus 同步有問題"
node scripts/totem-intelligence.mjs build-index
node scripts/totem-intelligence.mjs context "銅魁儡背包防巢狀" primary
node scripts/totem-intelligence.mjs impact "<files>" "<modules>"
node scripts/totem-intelligence.mjs test-plan "<task>" "<modules>" "<files>"
node scripts/totem-intelligence.mjs render-graph
```

本機 code index 與 runtime state 只寫入 `.totem-index/`，不進 Git。`build-index`／incremental refresh／impact 會在需要時更新 Flutter graph asset；graph generation failure 不應反過來使成功的 RAG/impact/test planning 失敗。

完整說明見 [`docs/codex-intelligence.md`](docs/codex-intelligence.md)。

## Flutter Viewer and Local Bridge

手動產生 graph asset：

```sh
node scripts/render-flutter-graph.mjs
```

Local Bridge：

```sh
node scripts/serve-local-viewer.mjs
```

預設 endpoint 是 `127.0.0.1:18765`：

```text
/        Flutter Web UI
/api/*   loopback workspace/runtime API
```

Flutter 支援 curated architecture、progressive semantic LOD、relation filters、Change Intelligence、Verification Graph、Agent Activity、Prompt、Development Replay，以及桌機／觸控／鍵盤操作。詳細操作見 [`viewer_flutter/README.md`](viewer_flutter/README.md) 與 [`docs/local-live-viewer.md`](docs/local-live-viewer.md)。

## Development lifecycle

非 trivial Totem 工作使用一致生命週期：

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

`intelligence/orchestration-plan.mjs` 決定 affected modules/contracts、read/write scopes、dependency waves、concurrent-write limits、required validation 與 security/release constraints。Runtime 決定是否委派、agent specialization 與 scheduling；固定 agent topology 不是 contract。

## Agent Runtime

Node.js 是 Workspace Intelligence 與執行層，不是已退休的 browser JavaScript Viewer。主要保留範圍：

```text
intelligence/*.mjs
intelligence/agent-runtime/*.mjs
mcp/server.mjs
scripts/*.mjs
tools/codex-discord/*.mjs
```

Shared runtime CLI：

```sh
node scripts/totem-runtime.mjs capabilities
node scripts/totem-runtime.mjs run --read-only "inspect TotemCore Observer contract"
node scripts/totem-runtime.mjs resume --thread <thread-id> "continue the same task"
```

Browser Prompt 不能指定 executable、cwd、sandbox、model 或 CLI flags；只有 runtime 實際事件才能成為 agent/model/usage evidence。

## Remote development

Remote-SSH controller：

```sh
bash tools/remote/bridge.sh doctor
bash tools/remote/bridge.sh start
bash tools/remote/bridge.sh status
bash tools/remote/bridge.sh logs
```

Bridge 只綁 loopback；有 tmux 時優先使用 tmux，否則使用 no-sudo nohup fallback。詳細設定見 [`tools/remote/README.md`](tools/remote/README.md)。

## Validation and release

Repository tooling 的主要 validators 由 `.github/workflows/validate.yml` 與 Flutter/inventory workflows 執行。Active Minecraft module 的 Gradle、compile、test、GameTest、runtime probe、remap 與 release gate 一律使用 Java 25。

正式發布流程與 Modrinth API read-back 規則見 [`docs/release-checklist.md`](docs/release-checklist.md)。11 個模組的最後完整發布快照見 [`docs/current-status.md`](docs/current-status.md)。

DeadRecall 已停止維護，不列入現役模組。

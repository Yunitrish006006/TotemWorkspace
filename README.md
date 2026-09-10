# TotemWorkspace

TotemWorkspace 是現役 Totem Minecraft 模組的公開協作、架構知識與開發控制平面。本 repository 本身不是 Minecraft 模組；它集中保存模組版本快照、依賴契約、開發規範、發布檢查表、Workspace Intelligence、Local Bridge／Agent Runtime，以及 Flutter 架構 Viewer。

目前正式模組快照日期為 **2026-09-02**，基線為 Minecraft 26.2、Java 25，共 11 個現役 Totem 模組。模組發布狀態與 Workspace tooling 的開發進度是不同時間軸；最新 tooling 狀態以 `main` 與 CI 為準。

[開啟 GitHub Pages Flutter 主介面](https://yunitrish006006.github.io/TotemWorkspace/)
｜[Curated HTML](index.html)
｜[AI Development Graph 計畫](docs/ai-development-graph-plan.md)
｜[Flutter Viewer](viewer_flutter/README.md)

`index.html` 目前仍是經驗證的 curated 架構來源。Runtime code index 與同一套 validated knowledge 經 `buildGraphViewModel()` 組合後，直接產生 `viewer_flutter/assets/graph-data.json`。**Flutter 是唯一維護中的 Viewer；舊 browser JavaScript viewer、`/legacy/` 路由與 `viewer/generated/graph-data.js` 已退休。**

![Totem 模組功能與依賴圖預覽](docs/images/dependency-graph.png)

## 快速連結

- [模組總表](docs/module-catalog.md)
- [依賴與軟整合契約](docs/dependency-contracts.md)
- [開發注意事項](docs/development-guidelines.md)
- [Codex Workspace Intelligence](docs/codex-intelligence.md)
- [CodexDiscord 開發介面](tools/codex-discord/README.md)
- [Flutter Viewer](viewer_flutter/README.md)
- [AI Development Graph](docs/ai-development-graph-plan.md)
- [發布檢查表](docs/release-checklist.md)
- [目前模組原始碼／發布快照](docs/current-status.md)
- [機器可讀快照](data/modules.json)

## 架構資料流

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

Curated contracts 與 generated implementation evidence 必須保持不同責任：code index 可以補充實際 file、symbol、test 與 component evidence，但不能自行新增或改寫 dependency contract。`test-matrix.json` 代表 required verification，不代表測試已通過；planned orchestration/model hints 也不代表實際 agent lifecycle 或 model usage。

## Workspace Intelligence

本 repository 提供 graph-first workspace RAG，直接從已驗證架構與本機 code index 導出模組、功能、契約、shared capability、implementation 與 verification context。V1 不依賴 embedding、向量資料庫或外部 API。

常用指令：

```sh
node scripts/totem-intelligence.mjs resolve "死亡背包跟 Nexus 同步有問題"
node scripts/totem-intelligence.mjs orchestrate "死亡背包跟 Nexus 同步有問題"
node scripts/totem-intelligence.mjs build-index
node scripts/totem-intelligence.mjs context "銅魁儡背包防巢狀" primary
node scripts/totem-intelligence.mjs impact "<files>" "<modules>"
node scripts/totem-intelligence.mjs test-plan "<task>" "<modules>" "<files>"
```

本機 index 只寫入 `.totem-index/`，不進 Git。`build-index`、incremental refresh 與 Bridge refresh 的 graph generation 現在只更新 Flutter JSON asset；`scripts/render-graph-v2.mjs` 僅保留為相容入口並委派給 Flutter graph generator，不再產生 browser JavaScript artifact。

完整 MCP、Codex Skill 與 retrieval lifecycle 見 [Codex Workspace Intelligence](docs/codex-intelligence.md)。

## Flutter Viewer

`viewer_flutter/` 是 production Viewer，GitHub Pages 與 Local Bridge 都以 Flutter Web/Wasm 為唯一 UI。

Flutter 使用同一份 `buildGraphViewModel()`，支援 curated architecture、progressive semantic LOD、精確 endpoint、關係篩選、spotlight、change intelligence、Verification Graph、Agent Activity、Prompt、Development Replay，以及桌機／觸控／鍵盤操作。

手動產生 graph asset：

```sh
node scripts/render-flutter-graph.mjs
```

本機執行：

```sh
node scripts/serve-local-viewer.mjs
cd viewer_flutter
flutter pub get
flutter run -d chrome
```

Local Bridge 固定預設綁定 `127.0.0.1:18765`。`/` 是 Flutter UI，`/api/*` 是 loopback API；不再提供 `/legacy/` 或 `graph-v2.html` Viewer。公開 Pages 可依白名單連回使用者自己的 loopback Bridge，但不會把本機 source、未提交 diff 或絕對路徑打包進 Pages。

## 開發生命週期

非 trivial Totem 開發使用一致生命週期：

```text
resolve_task
  → orchestration_plan
  → bounded context
  → implementation
  → impact
      → incremental code-index refresh
      → Flutter graph refresh
  → test_plan
  → required review
  → actual Gradle / GameTest / E2E validation
```

`intelligence/orchestration-plan.mjs` 決定 affected modules/contracts、read/write scopes、dependency waves、concurrent-write limits、required validation 與 security/release constraints。Runtime 自行選擇是否委派、agent specialization 與 scheduling；execution constraints 是 contract，固定 agent topology 不是 contract。

## Agent Runtime

Node.js 仍是 Workspace Intelligence 與執行層的一部分，**不屬於已移除的 browser JavaScript Viewer**。保留範圍包括：

```text
intelligence/*.mjs
intelligence/agent-runtime/*.mjs
mcp/server.mjs
scripts/*.mjs
tools/codex-discord/*.mjs
```

Phase 5 的 opt-in Codex Agent Adapter 使用 `intelligence/agent-runtime/` 共用 runtime。啟用後 Bridge／Web／Discord 共用 developer instructions、model discovery/routing、thread/turn lifecycle、approvals、steering、cancellation 與 usage adapter。瀏覽器不能指定 executable、cwd、sandbox、model 或 CLI flags；只有實際 runtime event 才能成為 task／agent activity。

Shared runtime CLI：

```sh
node scripts/totem-runtime.mjs capabilities
node scripts/totem-runtime.mjs run --read-only "inspect TotemCore Observer contract"
node scripts/totem-runtime.mjs resume --thread <thread-id> "continue the same task"
```

## VS Code Remote-SSH / tmux Bridge

遠端開發時 Bridge 仍只綁 loopback，repository 內 controller 有 tmux 時優先使用 tmux，否則 fallback 到 nohup：

```sh
bash tools/remote/bridge.sh doctor
bash tools/remote/bridge.sh start
bash tools/remote/bridge.sh status
bash tools/remote/bridge.sh logs
```

要讓 Flutter Prompt 交給 Codex：

```sh
export TOTEM_AGENT_ADAPTER=codex
export TOTEM_CODEX_CWD="$HOME/workspace"
export TOTEM_CODEX_SANDBOX=workspace-write
bash tools/remote/bridge.sh doctor
bash tools/remote/bridge.sh restart
node scripts/totem-activity.mjs prompt on
```

`TOTEM_CODEX_MODEL` 是可選偏好；未設定時由 shared router 依 runtime catalog 與 task constraints 選擇並 graceful fallback。Bridge 不繞過 approval 或 sandbox。

## Discord 與 Flutter 共用工作階段

啟用 CodexDiscord 本機同步後，Flutter Viewer 與 Discord 是同一個 TotemWorkspace Codex queue 的兩個操作介面。完整 Prompt 只存在允許的本機 conversation/runtime 邊界；development replay 保存的是 bounded activity 與 milestone，而不是把完整私密 transcript 當架構資料。

## 發布與驗證

Active Minecraft module 的 Gradle、compile、test、GameTest、runtime probe、remap 與 release gate 一律使用 Java 25。正式發布流程與 Modrinth API read-back 規則見 [發布檢查表](docs/release-checklist.md)；11 個模組的最後完整發布快照見 [目前原始碼與發佈狀態](docs/current-status.md)。

DeadRecall 已停止維護，不列入現役模組。

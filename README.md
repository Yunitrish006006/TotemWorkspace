# TotemWorkspace

TotemWorkspace 是 11 個現役 Totem 模組的公開協作與文件總表。這裡集中保存模組版本快照、依賴契約、開發規範、發布檢查表，以及可互動的統一功能／依賴圖；本 repository 本身不是 Minecraft 模組。

目前快照日期為 **2026-09-02**。本次整理 11 個現役模組的正式版本，補齊 Totem 物品配方取得進度、Alchemy 可切換的釀造材料自動登錄，以及 Remnant 回聲碎片結晶途徑；curated 互動圖共有 **58 個**可展開功能分支。

[開啟 GitHub Pages Flutter 主介面](https://yunitrish006006.github.io/TotemWorkspace/)
｜[Legacy 3D 同步介面](https://yunitrish006006.github.io/TotemWorkspace/legacy/)
｜[Curated HTML](index.html)
｜[本機 V2 3D](graph-v2.html)
｜[AI Development Graph 計畫](docs/ai-development-graph-plan.md)
｜[Flutter Viewer Roadmap](docs/flutter-viewer-roadmap.md)

`index.html` 目前仍是經驗證的 curated 架構來源。V2 則拆成純 renderer 與獨立 generated data：`graph-v2.html` 本身不保存任何 module／feature／contract／code-index 資料；資料只存在 `viewer/generated/graph-data.js`，並由同一套 validated knowledge + 本機 code index 產生，因此不建立第三份人工 dependency graph。

![Totem 模組功能與依賴圖預覽](docs/images/dependency-graph.png)

## 快速連結

- [模組總表](docs/module-catalog.md)
- [依賴與軟整合契約](docs/dependency-contracts.md)
- [開發注意事項](docs/development-guidelines.md)
- [Codex Workspace Intelligence](docs/codex-intelligence.md)
- [CodexDiscord 開發介面](tools/codex-discord/README.md)
- [Flutter Viewer Migration](docs/flutter-viewer-roadmap.md)
- [AI Development Graph](docs/ai-development-graph-plan.md)
- [發布檢查表](docs/release-checklist.md)
- [目前原始碼狀態](docs/current-status.md)
- [機器可讀快照](data/modules.json)

## Codex Workspace Intelligence

本 repository 同時提供一層給 Codex／CodexDiscord 使用的 **graph-first workspace RAG**。它不另外維護第三份依賴圖，而是直接從已驗證的 `index.html` 與 `data/modules.json` 導出 11 個模組、58 個功能分支、硬依賴、Fabric `suggests`、runtime optional、EventBus、外部服務與 Observer provider 關係。

V1 使用本機 lexical／symbol code index，不需要 embedding、向量資料庫或外部 API。主模型可先用 MCP 的 `resolve_task` 與 `context_pack` 縮小模組與契約範圍，再把 implementation、探索與 review 分配給 bounded subagents；修改後使用 `impact` 與 `test_plan` 決定需回看哪些 sibling modules。

```sh
node scripts/totem-intelligence.mjs resolve "死亡背包跟 Nexus 同步有問題"
node scripts/totem-intelligence.mjs orchestrate "死亡背包跟 Nexus 同步有問題"
node scripts/totem-intelligence.mjs build-index
node scripts/totem-intelligence.mjs context "銅魁儡背包防巢狀" primary
```

本機 index 只寫入 `.totem-index/`，不進 Git。MCP、Codex Skill、CodexDiscord 設定方式見 [Codex Workspace Intelligence](docs/codex-intelligence.md)。

## 自動 V2 3D 架構圖

V2 現在是 standalone 3D viewer；舊 2D renderer 已移除：

```text
graph-v2.html                       # 純 HTML shell，沒有架構資料
viewer/graph-v2.css                 # 畫面樣式
viewer/graph-v2-adapter.js          # architecture-only fallback adapter
viewer/graph-v2-cluster-v2.js       # standalone 3D renderer
viewer/local-live.js                # localhost live workspace adapter；Pages 上自動停用
viewer/generated/graph-data.js      # JS viewer 的自動 generated data
```

資料層再分成：

- **Curated 層**：11 modules、58 features、32 contracts，仍由原有驗證過的 Workspace 資料決定。
- **Generated code-detail 層**：由 `.totem-index` 中實際存在的 file path、test file、symbol 名稱產生；不包含 source body，也不能新增或改寫 dependency contract。
- **3D standalone viewer**：Core 固定在世界中心；展開 cluster 使用 deterministic relation-aware placement，並支援精確 feature/capability endpoint、線條類型篩選、spotlight、桌機與觸控操作。
- **Local live mode**：`node scripts/serve-local-viewer.mjs` 只綁 `127.0.0.1`，可顯示 sibling repos 的 branch / HEAD / dirty / snapshot drift，並做增量 index + graph refresh。

一般修改完成後的流程：

```text
implementation
  -> impact
      -> incremental RAG refresh
      -> regenerate viewer/generated/graph-data.js (best effort)
  -> test_plan
  -> reviewer
  -> Gradle / GameTest
```

正常 code/architecture 資料更新不會改寫 HTML、CSS 或 renderer JS。需要手動重建 generated data 時：

```sh
node scripts/totem-intelligence.mjs render-graph
```

如果 V2 data generation 失敗，只會回報 warning；不能讓原本成功的 `impact` 或 code-index refresh 失敗。

## Flutter Viewer Migration

`viewer_flutter/` 是下一代 viewer 的並行 migration prototype；在 production cutover 前不取代目前 JavaScript viewer。

Flutter 不維護自己的 architecture graph。`scripts/render-flutter-graph.mjs` 直接呼叫同一個 `buildGraphViewModel()`，輸出 `viewer_flutter/assets/graph-data.json`，確保 JS 與 Flutter renderer 使用相同語意來源。

目前 Flutter 已完成 curated 3D architecture parity 與 Web LIVE LOCAL：feature cluster、relation-aware placement、精確 endpoint、線條篩選、spotlight、桌機／觸控／鍵盤操作，以及 branch / HEAD / dirty / snapshot drift、日文語系完整度輪詢與增量 graph refresh。

本機執行：

```sh
node scripts/serve-local-viewer.mjs
cd viewer_flutter
flutter pub get
flutter run -d chrome
```

Local Bridge 固定綁定 `127.0.0.1:18765`。現在本機／Remote-SSH Bridge 與 GitHub Pages 使用相同路由：`/` 是 Flutter production UI、`/legacy/` 是舊 JavaScript rollback/debug surface、`/api/*` 是 loopback API。公開 Pages 只允許連回 loopback bridge，不會把本機 source、未提交 diff 或絕對路徑打包進 Pages。

Prompt 預設關閉，而且只控制 Prompt 輸入框；Agent Activity 與 Graph 功能保持獨立。連上 Local Bridge 後可直接從 Viewer 切換 Prompt，也可用 CLI：

```sh
node scripts/totem-activity.mjs prompt on
node scripts/totem-activity.mjs emit file_edit \
  --module totem-automata \
  --feature totem-automata.feature-4 \
  --file src/client/java/dev/totem/automata/client/CopperGolemVisualizationClient.java \
  --summary "editing outline rendering"
node scripts/totem-activity.mjs status
node scripts/totem-activity.mjs replay
node scripts/totem-activity.mjs replay 42
```

Phase 1 的 Prompt intake 只會寫入本機 activity stream；在 Agent Adapter 完成前不會直接從瀏覽器執行 shell 或假裝 Codex 已開始工作。

Phase 2 加入 progressive semantic LOD：`Module → Feature → Component / Responsibility → Implementation`。Component 從 production-code-only package/class/symbol/surface evidence 泛用推導，只有高信心才掛到 curated Feature；弱或模糊證據保留在 module-level。Implementation files 只在 Component 展開或 Agent Activity 聚焦該 Component 時顯示，不做全域展開。

Phase 3 加入 change intelligence：Local Bridge 在重新索引前後建立 semantic snapshot，將 sibling repositories 的 Git working-tree diff 映射到 Module / Feature / Component / Implementation，再用既有 impact analysis 傳播跨模組影響。Flutter 與 legacy 3D 使用同一份 `/api/change-intelligence`，變更 entity／relation 以 change animation 顯示，受影響 module 顯示 impact halo；本機結果只保存於 `.totem-index/change-intelligence.json`。

Phase 4 加入 Verification Graph：實際被 code index 掃到的 Test / GameTest / E2E 檔案才會成為 Test entity，穩定 ID 為 `test:<module-id>:<repo-relative-path>`；`test-matrix.json` 只代表 required verification，不會被當成已通過證據。Feature、contract/API 與 shared capability 可產生 `validated-by` 關係；Local Bridge 透過 `/api/verification-state` 保存與傳送 `test_started / test_passed / test_failed` 最新狀態，Flutter 與 legacy 3D 同步顯示 Test LOD、驗證線與 pass/run/fail highlighting。

Phase 5 加入 opt-in Codex Agent Adapter：只有主機端設定 `TOTEM_AGENT_ADAPTER=codex` 時，Prompt 才會透過 `codex exec --json` 建立真實 Codex task；瀏覽器不能指定 executable、cwd、sandbox、model 或 CLI flags。Bridge 會輸出 `task_started / task_completed / task_failed`，把 Codex JSONL 的 file change / MCP activity 映射回既有 activity graph，task 結束後自動重新索引並更新 Phase 3 change intelligence。Adapter 未啟用或 Codex 不可用時，Prompt 只記錄為 submitted，不會假裝 agent 已開始。

Phase 6 加入 Development Replay：Bridge 會把 bounded activity、task session、commit/PR/deployment milestone 與 refresh checkpoint 持久化到 `.totem-index/development-replay.json`，重啟後 sequence 不歸零。Flutter 與 legacy 都有 timeline scrubber；拖到歷史 sequence 時會重建該時點的 Activity、Phase 3 change/impact、Phase 4 verification 狀態，並依 checkpoint 隱藏當時尚不存在的 graph entity/edge；按 `LIVE` 回到最新狀態。

Phase 7 加入 Adaptive Orchestration：每次非 trivial Prompt 由 TotemWorkspace 依 Module span、跨模組 contract、TotemCore/shared surface、risk 與 verification breadth 計算 deterministic orchestration score，選擇 `primary-only / assisted / bounded-parallel / guarded-parallel`。Planner 最多規劃 4 個 subagents、2 個平行 write workers；Explorer／Architect／Reviewer 唯讀，Worker 僅能寫入單一指派模組。MCP、CLI、Bridge、Codex prompt envelope、Flutter／legacy ORCH 狀態與 Replay 都使用同一份 plan；若 runtime 沒有 multi-agent 能力，Primary 依同一 waves 序列執行，不會捨棄邊界或假造 child-agent telemetry。

### VS Code Remote-SSH / tmux Bridge

遠端開發時，Bridge 預設使用 `127.0.0.1:18765`，並可由 repository 內的 background controller 執行；有 tmux 時優先使用 tmux，否則 fallback 到 nohup：

```sh
bash tools/remote/bridge.sh doctor
bash tools/remote/bridge.sh start
bash tools/remote/bridge.sh status
bash tools/remote/bridge.sh logs
```

要讓 Viewer Prompt 直接交給 Codex，先確認遠端使用者可執行 `codex --version`，再以主機環境啟用：

```sh
export TOTEM_AGENT_ADAPTER=codex
export TOTEM_CODEX_CWD="$HOME/workspace"
export TOTEM_CODEX_SANDBOX=workspace-write
bash tools/remote/bridge.sh doctor
bash tools/remote/bridge.sh restart
node scripts/totem-activity.mjs prompt on
node scripts/totem-activity.mjs status
```

`TOTEM_CODEX_MODEL` 可選；未設定時沿用 Codex 本身的 model 設定。Bridge 不會自動加入 `--full-auto` 或 dangerous approval/sandbox bypass。

### Discord 與網頁共用開發工作階段

啟用 CodexDiscord 的本機同步後，Flutter Viewer 和 Discord 是同一個 TotemWorkspace Codex 佇列的兩個操作介面：網頁草稿會鏡像到 Discord、兩端送出的 Prompt 與經過白名單投影的處理狀態都會雙向顯示。完整 Prompt 只保留在 Bridge 記憶體中，不寫入 development replay；同步 API 只接受 loopback Viewer 或持有私有 token 的 CodexDiscord。

CodexDiscord 現在是本 repository 的 `tools/codex-discord/` 子樹；它仍使用獨立的 Discord Bot application，並不取代 Minecraft 的 TotemDiscordBridge。

在啟動 Bridge 的環境檔設定一組至少 16 字元、僅供這兩個本機服務共用的 token：

```sh
export TOTEM_CONVERSATION_SYNC_TOKEN='replace-with-a-long-random-secret'
```

同一 token 與 Discord channel 設定在 CodexDiscord 的 `.env`。Discord 無法讓 Bot 讀取使用者尚未送出的輸入文字，因此 Discord → 網頁會在訊息送出後同步；網頁 → Discord 的未送出草稿則以 Bot 管理的預覽訊息節流鏡像。

`start` 會對 `viewer_flutter/` 做內容指紋；build 缺失或過期時自動執行 `flutter build web --wasm --base-href /`。因此直接開 `http://127.0.0.1:18765/` 就是 Flutter，舊 JS 位於 `/legacy/`。

VS Code Remote-SSH 連線可在 Mac 的 `~/.ssh/config` 使用：

```sshconfig
Host csvr.4hotel.tw
    HostName csvr.4hotel.tw
    User thomas
    LocalForward 127.0.0.1:18765 127.0.0.1:18765
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

repository 也提供共享 `.vscode/tasks.json`。Remote-SSH 開啟 TotemWorkspace 後可直接執行 `Tasks: Run Task → Totem: Start Bridge`。完整操作與 stop/restart/attach/log follow 見 [Remote SSH Bridge](tools/remote/README.md)。

WebAssembly build：

```sh
flutter build web --wasm
```

目前 CI 固定 Flutter 3.47.0，驗證 loopback API、analyze、unit tests 與 Pages 路徑的 Web/Wasm build。完整 migration 階段與 production cutover 條件見 [Flutter Viewer Migration Roadmap](docs/flutter-viewer-roadmap.md)。

## 資料更新原則

各功能、畫面與 API 仍由原本的 11 個模組 repository 擁有；本 repository 只統整跨模組事實。版本、預設分支、完整 commit SHA、Fabric 依賴範圍與 Observer protocol 必須從擁有者 repository 重新核對後更新。`current-status.md` 與 `modules.json` 以原始碼快照為主；若另記 CI／Modrinth 狀態，必須附上獨立查驗證據，不從版本號推論。

自動生成的 V2 code-detail 節點只代表「索引確實看到這個檔案／symbol」，不代表新的架構所有權或模組依賴。DeadRecall 已停止維護；僅保留為相容性歷史背景，不列入現役模組或依賴圖。

## 本機驗證

```sh
node scripts/validate-workspace.mjs
node scripts/validate-intelligence.mjs
```

驗證器不需要安裝 npm 套件，支援 Node.js 20.19+；GitHub Actions 同時驗證 Node.js 20.19.4 與 Node.js 22。Flutter viewer 另由 `.github/workflows/flutter-viewer.yml` 驗證。

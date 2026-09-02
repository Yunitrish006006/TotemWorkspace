# TotemWorkspace

TotemWorkspace 是 11 個現役 Totem 模組的公開協作與文件總表。這裡集中保存模組版本快照、依賴契約、開發規範、發布檢查表，以及可互動的統一功能／依賴圖；本 repository 本身不是 Minecraft 模組。

目前快照日期為 **2026-09-02**。本次整理 11 個現役模組的正式版本，補齊 Totem 物品配方取得進度、Alchemy 可切換的釀造材料自動登錄，以及 Remnant 回聲碎片結晶途徑；互動圖共有 **58 個**可展開功能分支。

[開啟 GitHub Pages 互動式模組圖](https://yunitrish006006.github.io/TotemWorkspace/)
｜[直接開啟 repository 內的 HTML](index.html)

在總圖中，每個現役模組父節點都有自己的「功能 ×N」按鈕。按下後會在
父節點周圍散開該模組的功能分支；再選取功能，即可查看啟用此功能時可
搭配的軟依賴模組、關係方向、分類與未安裝時的降級行為。

![Totem 模組功能與依賴圖預覽](docs/images/dependency-graph.png)

## 快速連結

- [模組總表](docs/module-catalog.md)
- [依賴與軟整合契約](docs/dependency-contracts.md)
- [開發注意事項](docs/development-guidelines.md)
- [Codex Workspace Intelligence](docs/codex-intelligence.md)
- [發布檢查表](docs/release-checklist.md)
- [目前原始碼狀態](docs/current-status.md)
- [機器可讀快照](data/modules.json)

## Codex Workspace Intelligence

本 repository 同時提供一層給 Codex／CodexDiscord 使用的 **graph-first workspace RAG**。它不另外維護第三份依賴圖，而是直接從已驗證的 `index.html` 與 `data/modules.json` 導出 11 個模組、58 個功能分支、硬依賴、Fabric `suggests`、runtime optional、EventBus、外部服務與 Observer provider 關係。

V1 使用本機 lexical／symbol code index，不需要 embedding、向量資料庫或外部 API。主模型可先用 MCP 的 `resolve_task` 與 `context_pack` 縮小模組與契約範圍，再把 implementation、探索與 review 分配給 bounded subagents；修改後則使用 `impact` 與 `test_plan` 決定需回看哪些 sibling modules。

```sh
node scripts/totem-intelligence.mjs resolve "死亡背包跟 Nexus 同步有問題"
node scripts/totem-intelligence.mjs build-index
node scripts/totem-intelligence.mjs context "銅魁儡背包防巢狀" primary
```

本機 index 只寫入 `.totem-index/`，不進 Git。MCP、Codex Skill、CodexDiscord 設定方式見 [Codex Workspace Intelligence](docs/codex-intelligence.md)。

## 資料更新原則

各功能、畫面與 API 仍由原本的 11 個模組 repository 擁有；本 repository 只統整跨模組事實。版本、預設分支、完整 commit SHA、Fabric 依賴範圍與 Observer protocol 必須從擁有者 repository 重新核對後更新。`current-status.md` 與 `modules.json` 以原始碼快照為主；若另記 CI／Modrinth 狀態，必須附上獨立查驗證據，不從版本號推論。

DeadRecall 已停止維護；僅保留為相容性歷史背景，不列入現役模組或依賴圖。

## 本機驗證

```sh
node scripts/validate-workspace.mjs
node scripts/validate-intelligence.mjs
```

驗證器不需要安裝 npm 套件，支援 Node.js 20.19+；GitHub Actions 使用 Node.js 22。

# 目前原始碼狀態

快照日期：2026-08-31<br>
平台：Minecraft 26.2、Java 25<br>
範圍：11 個現役 Totem repository 的本機與 GitHub 同步原始碼狀態

| 模組 | 版本 | 預設分支 | 完整 commit SHA |
| --- | --- | --- | --- |
| TotemAlchemy | 0.1.40 | `main` | `0d90b905d5d53ff8275046ea93572d10a10bd8f2` |
| TotemAutomata | 0.1.20 | `master` | `23a2cf504a993ca50697c93e335b7513ed070ed2` |
| TotemCore | 0.7.14 | `master` | `8407f3ad58c21db03758242a2dea552364b08963` |
| TotemDiscordBridge | 0.1.8 | `master` | `381ba9f3b0d2bad47a31061abec1981534c6c92c` |
| TotemEnchanting | 0.1.9 | `main` | `96977007116cd47ca877a6af57f863e87f1b7875` |
| TotemExcavation | 0.1.9 | `master` | `1831c31cfe16ac23392e28fe155e222c510fbae9` |
| TotemLocksmith | 0.1.6 | `main` | `7b4005028279df31e96d7e8446e4293086595a25` |
| TotemNexus | 0.3.7 | `master` | `2ac678451a37536ce5ea86c234e6268af37cbc06` |
| TotemRemnant | 0.2.16 | `master` | `b7a8479f3d51456cf9be83d645d2c777097ac124` |
| TotemVanillaTweaks | 0.1.20 | `main` | `a6ac2bfe57476a4db9692bca2e6be7687b624ae8` |
| TotemVillagers | 0.1.33 | `main` | `c32faf6ffd5d9135f68a3915e1dfa7f31d09dad9` |

## 本次 source 變更

2026-08-30 快照到本次 HEAD 之間，只有下列四個 repository 出現新 commit：

- **TotemCore 0.7.14**：加入 client-only、無狀態的 `TotemWorldOutlines` API，可提交方塊、長方體與任意兩點實線；`WorldOutlineStyle` 明確攜帶 ARGB、線寬與 `DEPTH_TESTED`／`THROUGH_WALLS` 遮擋模式。
- **TotemAutomata 0.1.20**：採集工作區改用 Core 青色深度遮擋框線；銅魁儡至來源／目的地改用橘／綠／紅實線表示可用性，並由地形遮住不可見部分。採集目標與阻塞粒子仍保留。
- **TotemExcavation 0.1.9**：主手槌選區改由 Core 提交青色深度遮擋長方體，牆後線段不顯示；伺服器授權選區與挖掘行為未改。
- **TotemNexus 0.3.7**：Space Unit「材料」頁新增來源限定的「顯示／隱藏傳送陣」。Server 重跑同一套 loaded-only 材料掃描，回傳有界相對座標；Client 以青／金／紫穿牆框線區分計入方塊、擴張發射材料與來源磁石，30 秒後或情境失效時清除。Observer 模式不送出要求。

其餘七個現役 repository 的版本與 commit 未變。三個消費世界輪廓 API 的模組也同步提高 Core 下限：Automata `>=0.7.14 <0.8.0`；Excavation 與 Nexus `>=0.7.13 <0.8.0`。

## 狀態邊界

- **Source state**：上表來自各 repository 的 `gradle.properties`、`fabric.mod.json` 與本機 HEAD；整理時 11 個分支皆與已設定 upstream 顯示 ahead 0／behind 0。
- **CI state**：本次 TotemWorkspace 更新沒有重新查詢各模組 GitHub Actions，因此不宣告目前 workflow 是否全綠；新增功能只記錄擁有 repo 內已有的 unit、GameTest、Client GameTest 與視覺證據。
- **Modrinth state**：部分 source commit 含發布紀錄檔，但本快照沒有連線查驗 Modrinth 專案頁，因此不把 source 版本號或紀錄檔當作現時發布狀態證明。

也就是說，本文件只證明整理時採用的 source commit 與當時已核對的 GitHub upstream 一致；CI 與 Modrinth 必須分別從對應服務另行確認。

DeadRecall 已停止維護，未列入 11 個現役模組。

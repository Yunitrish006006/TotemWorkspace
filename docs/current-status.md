# 目前原始碼與發佈狀態

快照日期：2026-09-02<br>
平台：Minecraft 26.2、Java 25<br>
範圍：11 個現役 Totem repository 的 GitHub 同步原始碼與各自驗證過的 Modrinth 版本

| 模組 | 版本 | 預設分支 | 完整 commit SHA |
| --- | --- | --- | --- |
| TotemAlchemy | 0.1.41 | `main` | `0056a0096dcdb06f03f870edbc9f6b56259a466d` |
| TotemAutomata | 0.1.21 | `master` | `8c9b90bbffb64f4058ffc7978bad1798e8944779` |
| TotemCore | 0.7.16 | `master` | `b0b57bc98a98140a1c12a660a33952ea61167278` |
| TotemDiscordBridge | 0.1.8 | `master` | `6ef67ed58ebe3a6b9ee9a4d328c668ab93c17453` |
| TotemEnchanting | 0.1.9 | `main` | `17719ec20eed31938107aa069986c32e5ce5b053` |
| TotemExcavation | 0.1.10 | `master` | `646f82e5961255dc1b28aee1f800463b55f70002` |
| TotemLocksmith | 0.1.8 | `main` | `d73112169e73e717f02ef4a068e5cbd2782eb5e7` |
| TotemNexus | 0.3.12 | `master` | `41ba0b2e11b0a5745f8b7ffb9c6d71e45d9288f7` |
| TotemRemnant | 0.2.18 | `master` | `c828f42cee767b98a69d2bebd532b63f322c3b0e` |
| TotemVanillaTweaks | 0.1.21 | `main` | `5d2d352453ef6abd9f59ddac8b203d7d5c5d87af` |
| TotemVillagers | 0.1.34 | `main` | `9798ee3578affc2624edfcfb2343ec7aa95405df` |

## 本次整理與功能發佈

- **TotemAlchemy 0.1.41**：補齊煉金物品的原版配方取得進度。首次取得可釀造材料時，依可切換的世界規則自動寫入釀造說明書一次，不增加研究次數，Client 會顯示物品飄到畫面前旋轉的提示。
- **TotemAutomata 0.1.21**：取得銅箱後可解鎖銅扳手配方。
- **TotemExcavation 0.1.10**：木、石、銅、鐵、金、鑽石與獄髓七階槌都有對應材料觸發的配方取得進度。
- **TotemLocksmith 0.1.8**：補齊掛鎖、鑰匙胚與回收綁定鑰匙的配方取得進度。
- **TotemRemnant 0.2.18**：補齊染色背包與擴充配方取得進度；使用紫水晶碎片點擊會掉落經驗的遠古城市伏聆方塊，可結晶取得回聲碎片，規則與手冊同步。
- **TotemVillagers 0.1.34**：補齊植物纖維線與 Woodcutter 的配方取得進度。
- **TotemDiscordBridge 0.1.8**、**TotemEnchanting 0.1.9**：原始碼版本不變，本次補完成正式 Modrinth 發佈與驗證紀錄。
- **TotemCore 0.7.16**、**TotemNexus 0.3.12**、**TotemVanillaTweaks 0.1.21**：沿用已驗證的目前正式版本。

## 驗證證據

- 本次有功能變更的六個模組均完成本機 `build` 與 Server GameTest：Alchemy 26、Automata 39、Excavation 27、Locksmith 20、Remnant 51、Villagers 125，共 288 項；Alchemy 的材料登錄 Client 視覺測試另有 3 項通過。
- 六個功能版本的 GitHub Build workflow 均通過；Excavation／Locksmith 後續只修改發佈驗證腳本，其最新 Build 也通過。
- 每個 Modrinth 流程都以 API 回讀版本，核對專案、版本號、Minecraft 26.2、Fabric loader、主檔名與 SHA-512，成功後才將 `modrinth-published-<version>.json` 寫回擁有模組。
- 11 個正式版本均已有獨立驗證紀錄；若專案仍處於 Modrinth 審核中的 `processing` 狀態，公開頁面需等待平台審核完成，但版本檔與審核申請已提交。

| 模組版本 | Modrinth version ID | 驗證 workflow |
| --- | --- | --- |
| TotemAlchemy 0.1.41 | `D06mr5im` | [33565459727](https://github.com/Yunitrish006006/TotemAlchemy/actions/runs/33565459727) |
| TotemAutomata 0.1.21 | `IcxJFBlc` | [33565462948](https://github.com/Yunitrish006006/TotemAutomata/actions/runs/33565462948) |
| TotemCore 0.7.16 | `Z7Z0yoq5` | [33546528384](https://github.com/Yunitrish006006/TotemCore/actions/runs/33546528384) |
| TotemDiscordBridge 0.1.8 | `xyVUsvJi` | [33565808577](https://github.com/Yunitrish006006/TotemDiscordBridge/actions/runs/33565808577) |
| TotemEnchanting 0.1.9 | `5W16xCsJ` | [33565811547](https://github.com/Yunitrish006006/TotemEnchanting/actions/runs/33565811547) |
| TotemExcavation 0.1.10 | `6fIXplzc` | [33568056893](https://github.com/Yunitrish006006/TotemExcavation/actions/runs/33568056893) |
| TotemLocksmith 0.1.8 | `LexVXnLd` | [33567024089](https://github.com/Yunitrish006006/TotemLocksmith/actions/runs/33567024089) |
| TotemNexus 0.3.12 | `z9dpdxCr` | [33546945839](https://github.com/Yunitrish006006/TotemNexus/actions/runs/33546945839) |
| TotemRemnant 0.2.18 | `XpzzWZ5Q` | [33565467924](https://github.com/Yunitrish006006/TotemRemnant/actions/runs/33565467924) |
| TotemVanillaTweaks 0.1.21 | `LtMMrH7X` | [33422106576](https://github.com/Yunitrish006006/TotemVanillaTweaks/actions/runs/33422106576) |
| TotemVillagers 0.1.34 | `u2jEjYHl` | [33565471249](https://github.com/Yunitrish006006/TotemVillagers/actions/runs/33565471249) |

## 狀態邊界

- **Source state**：上表來自各 repository 的 `gradle.properties`、`fabric.mod.json` 與同步後 HEAD；整理完成時 11 個工作樹皆乾淨，預設分支均與 upstream 顯示 ahead 0／behind 0。
- **CI state**：建置與發佈狀態來自本次實際查詢的 GitHub Actions，不由版本號推論。
- **Modrinth state**：發佈狀態來自具權限 API 的回讀驗證與各 repository 內的 SHA-512 發佈標記，不把單純存在的版本字串視為成功證明。

DeadRecall 已停止維護，未列入 11 個現役模組。

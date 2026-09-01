# 依賴與軟整合契約

本文件把「必須安裝」、「安裝後才啟用」、「外部服務」與「事件訂閱」分開。這些分類不可因為圖面方便而合併。

## 硬依賴

除 TotemCore 本身以外，十個現役功能模組都在 `fabric.mod.json` 硬依賴 TotemCore 0.7.x：

- TotemAlchemy：`>=0.7.15 <0.8.0`（使用共用世界規則分類）
- TotemAutomata：`>=0.7.14 <0.8.0`（使用共用兩點實線）
- TotemExcavation：`>=0.7.13 <0.8.0`（使用共用長方體輪廓與遮擋模式）
- TotemNexus：`>=0.7.16 <0.8.0`（使用共用方塊輪廓與目前死亡節點契約）
- TotemLocksmith、TotemRemnant：`>=0.7.15 <0.8.0`
- TotemVanillaTweaks：`>=0.7.14 <0.8.0`
- TotemVillagers：`>=0.7.12 <0.8.0`
- TotemDiscordBridge、TotemEnchanting：`>=0.7.0 <0.8.0`

所有模組以 Minecraft 26.2、Java 25、Fabric Loader 0.19.3+ 為共同基線。

## Fabric `suggests`：恰好 3 條

| 來源 | 選配目標 | 功能 | 未安裝時 |
| --- | --- | --- | --- |
| TotemAutomata | TotemExcavation `>=0.1.5` | 七階 Excavation 槌可作為銅魁儡採集工具 | 不辨識槌；Automata 其他工作維持可用 |
| TotemVillagers | TotemRemnant `>=0.2.13` | 工具匠依即時鍛造配方製造並販售四階背包 | 不建立替代背包、工作單或交易列 |
| TotemRemnant | Trinkets Updated `>=4.1.0-beta.2` | 背包裝備與已驗證可掉落飾品欄的死亡擷取 | 略過飾品 provider，Remnant 基礎流程照常 |

## Runtime optional／compat：恰好 8 條

| 來源 | 目標 | 契約與方向 | 降級行為 |
| --- | --- | --- | --- |
| TotemAutomata | TotemRemnant | Automata 使用 Remnant `PortableContainerSafetyApi`，辨識可整理背包並防止非法巢狀 | 退回原版容器安全規則 |
| TotemAutomata | TotemLocksmith | 玩家綁定、抽取／插入及自動化轉移遵守 Locksmith v1 權限 API | 未安裝時維持普通操作；宣告安裝但 API 失效時 fail closed |
| TotemRemnant | TotemNexus | Nexus 將 `DeathBackpackNodeLifecycle` 與 `DeathRetainedItemPolicy` provider 註冊到 Core；Remnant 在死亡擷取／回收時消費契約 | 不建立 Nexus 死亡節點、不保留 Nexus 傳送介面；死亡背包仍獨立運作 |
| TotemVanillaTweaks | TotemRemnant | 使用模組自有 `remnant_backpack` v1 Observer provider | provider 缺少或不相容時只回報 unsupported metadata |
| TotemVanillaTweaks | TotemAutomata | 使用模組自有 `automata_copper_golem` v1 Observer provider | 同上 |
| TotemVanillaTweaks | TotemNexus | 使用模組自有 `nexus` v2 與 `nexus_death_node_admin` v1 Observer providers | 同上 |
| TotemVanillaTweaks | TotemLocksmith | 使用模組自有 `locksmith_management` v1 Observer provider | 同上 |
| TotemVanillaTweaks | TotemVillagers | 使用模組自有 `villagers_woodcutter` v1 Observer provider | 同上 |

Nexus `nexus` v2 的有效 variants 為 `map`、`map_legacy`、`friends`、`friends_legacy`、`registration`、`registration_legacy`。其他四個 family 與死亡管理 family 使用空 variant。

Observer 關係是 relay 對擁有者 provider 的 runtime compatibility，不是將 UI 所有權移到 TotemVanillaTweaks。缺少 provider 時禁止捏造 mirror Screen。

## 外部選配服務：恰好 2 條

| 來源 | 外部服務 | 功能 | 降級行為 |
| --- | --- | --- | --- |
| TotemDiscordBridge | Cloudflare Worker → Discord | HTTPS relay、Webhook／Bot 頻道、附件與 Presence | 缺設定時停用；外部失敗不阻塞伺服器 tick |
| TotemAutomata | OpenAI-compatible Chat Completions | 選配目的地與採集 prompt 判斷 | 未設定、逾時或格式錯誤時安全失敗 |

外部服務不是 Fabric 模組依賴。任何憑證都只能留在部署環境或私密設定中。

## EventBus：不是模組軟依賴

- TotemRemnant 發布死亡背包建立／回收事件。
- TotemNexus 發布公開 Space Unit 更新、死亡回收與管理稽核事件。
- TotemLocksmith 發布 `LockedContainerNetworkBrokenEvent`。
- TotemDiscordBridge 啟動後可自行向 TotemCore EventBus 訂閱以上事件。

發布者不 import 或要求 TotemDiscordBridge。沒有訂閱者時事件是安全 no-op，因此不能把這三組關係計入 8 條 runtime optional。

## Legacy compatibility

DeadRecall 已停止維護。Core、Alchemy、Automata、DiscordBridge、Remnant 中保留的舊 ID、載入檢查或反射 hook 只屬歷史相容，不是現役模組，也不進入現役依賴圖或 cardinality。

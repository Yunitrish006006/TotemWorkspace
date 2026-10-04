# 原生 Codex CLI 自動選模型

`scripts/codex-auto.mjs` 保留 Codex 原生 terminal UI，在每次使用者 `turn/start` 前，透過 TotemWorkspace 的既有 orchestration 與 model-policy 選擇模型／推理強度。同一個 thread ID 持續使用，原生 Codex 負責對話歷史、工具、核准與 sandbox。

## 使用

在 TotemWorkspace repository 安裝一次：

```sh
npm ci --prefix tools/codex-auto
node scripts/codex-auto.mjs --cwd ..
```

指定模組工作目錄或繼續已儲存對話：

```sh
node scripts/codex-auto.mjs --cwd ../TotemCore
node scripts/codex-auto.mjs --cwd .. -- resume THREAD_ID
node scripts/codex-auto.mjs -- --sandbox read-only
```

`--` 後的參數交給原生 CLI；`--config`、`--enable`、`--disable` 和 `--strict-config` 同時傳到專用 App Server。工作目錄與模型偏好使用 launcher 的 `--cwd`／`--model`；不接受另一個 `--remote` 或 profiles。`TOTEM_CODEX_BIN` 可指定本機 Codex executable。

需要 Linux/macOS、Node >=20.19，以及支援 `--remote unix://PATH` 的 Codex CLI。開發時使用 0.153.4 的本機協定 schema；App Server remote transport 是官方標為 experimental 的介面，版本升級後需要重新驗證。

## 路由行為

- 有界唯讀查詢／機械錯字工作優先輕量模型；一般實作優先 balanced 模型；高風險與共享契約遵守既有 strong-reasoning floor。
- 從 App Server 的 `model/list` 讀取實際目錄並處理分頁；目錄快取最多六十秒。配額未知時顯示為未知，不捏造 Spark 獨立額度或模型存取權。
- 圖像輸入、保留的圖像歷史與可觀測 context usage 參與能力選擇。回覆「繼續／那開始做」沿用上一任務；resume 無法恢復任務時採保守的 strong 偏好。
- `collaborationMode.settings` 的模型／推理強度同步調整，保留模式與 developer instructions，避免 Plan 模式覆蓋已選模型。
- Auto 模式會覆蓋原生 `/model` picker 在下一回合送出的模型。若需固定偏好，使用 `--model MODEL --effort EFFORT`；高風險要求仍不能因此降級。
- 已經開始的回合、`turn/steer`、工具輸出與 App Server 內部自動續跑不重新選模型。不因模型錯誤自動重播可能已有副作用的任務。
- `[Totem model] selected ... for next turn` 表示送出的選擇；不是已執行的模型證據。實際執行須核對 App Server 設定通知與成功完成的回合。

## 執行邊界

```text
原生 Codex CLI --remote unix://...
  → 專用模型路由代理
  → 專用 Codex App Server（stdio）
```

代理建立在私有 `0700` 暫存目錄，Unix socket 為 `0600`，不開 TCP 埠。拒絕帶 Origin 的瀏覽器連線與第二個客戶端；RPC ID 分隔內部目錄查詢、客戶端請求與伺服器核准請求。模型查詢不阻塞中斷／核准回覆。訊息、分頁、待處理請求與 thread 數皆有上限。

代理只改寫新回合的模型與推理強度。原生權限 profile、sandbox、核准策略、核准請求／回覆、其他 RPC 與事件原樣傳遞；不代為核准、不修改全域 Codex 設定。路由失敗則該回合不送出。

關閉 CLI 時只結束本次專用代理與 backend、清除本次暫存 socket。既有 MCP／Discord／Bridge／Codex 對話不會被重新啟動。代理不把 prompt、transcript、憑證或 backend stderr 寫入檔案；原生 Codex 仍依原有設定保存自己的歷史。

## 驗證

```sh
npm test --prefix tools/codex-auto
node tools/codex-auto/test/smoke.mjs
```

固定測試覆蓋模型分級、同 thread、延續風險、resume、Plan 模式、圖像／context、核准雙向傳遞、RPC ID 衝突、目錄分頁與快取、中斷、來源拒絕及程序清理。`validate.yml` 執行固定測試。

`smoke.mjs` 是 opt-in 真實推理檢查，需要已登入的本機 Codex 和網路／模型額度；使用 ephemeral read-only thread，禁止工具／寫檔，驗證兩種任務模型與成功完成的回合。此檢查不放入沒有帳號的公開 CI。

官方協定：[App Server／原生 CLI remote、model/list 與 turn/start](https://learn.chatgpt.com/docs/app-server)。

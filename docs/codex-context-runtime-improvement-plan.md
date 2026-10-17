# Codex Discord Context 與 Runtime 改善企劃

狀態：C0–C8 已完成，待授權生效；未發布  
擁有者：TotemWorkspace  
範圍：`intelligence/agent-runtime/`、`intelligence/agent-adapter.mjs`、`tools/codex-discord/`、相關 validators 與文件  
限制：不重啟或重複啟動現有 GPU client；不發布；每個微任務完成後留下 checkpoint，再進入下一項。

## 問題與目標

Discord 的短追問目前可能被當成上一個開發任務的延續，將舊查詢串接後重新做模組路由。結果是 token、服務狀態等操作性問題也可能攜帶多個遊戲模組、舊驗證矩陣及 repository context。續接雖已有精簡 bounded context 的候選修改，但仍以 `affectedModules` 為主要內容，尚未以 checkpoint 與證據雜湊作為穩定引用。

Runtime 已能接收部分 token usage，但缺少完整、可稽核且不含內容的輸入／快取／輸出／reasoning、bounded-context bytes 與 compaction 狀態。另因 Codex app-server 由 `codex-discord.service` 啟動，長時間 GPU/Minecraft 工作可能留在同一 user service cgroup；這會混淆記憶體觀察，服務重啟也可能連帶終止工作負載。

本企劃要達成：

1. 操作性與自我觀察問題不再繼承舊的遊戲模組範圍。
2. 續接只注入可驗證的小型引用；證據缺失、過期或矛盾時才展開。
3. 用量資訊只記錄數值與狀態，不記錄 prompt、秘密或未送出的輸入。
4. 非程式問題不觸發新的 repository 切換或重複 AGENTS 注入。
5. Bridge 與長時間工作負載使用不同 systemd user cgroup，且有明確 fallback。
6. 在 context 壓力升高前產生精簡 checkpoint；不得自動刪除歷史。

## 現況證據

- `prepareTurnRouting()` 對已有 query 的未識別句子預設為 follow-up，並把舊 query 與新文字串接；這會放大過期範圍。
- 工作樹已有 `boundedFollowupContext()` 與續接改用精簡 envelope 的候選修改，但尚未帶 checkpoint/task/evidence reference。
- `agent-adapter.mjs` 已正規化 input、cached input、cache-write input、output 與 reasoning output token；尚未形成一致的 privacy-safe turn telemetry contract。
- `.totem-index/work-checkpoint.json` 已有有界 checkpoint schema，可供引用，但 runtime follow-up 尚未以 digest 綁定它。
- `codex-discord.service` 直接啟動 Node bridge；Codex app-server 及其子工作負載會繼承 service cgroup。
- 目前工作樹有既有未提交修改，必須逐檔保留與複核，不得重置或冒認來源。

## 設計

### 路由分類

每一輪先分類為：

- `continuation`：明確的「繼續／照做／修好它」等指令，可沿用 active task。
- `development`：明確的查詢、修改、驗證或企劃，依本輪文字重新解析 owner 與 scope。
- `operational`：token、usage、服務狀態、進度、runtime／session 診斷等問題；預設 `affectedModules: []`，只有明確指名工具 owner 時才使用 `totem-workspace`。
- `ambiguous`：不拼接完整舊 query；只帶 active task reference，要求 runtime 在缺少必要資訊時釐清。

明確延續才可繼承上一輪語意。單純因 thread 已恢復，不足以把新訊息判定為延續。

### Follow-up evidence envelope

Envelope 保留固定上限與 allowlist 欄位：

- schema／mode
- task ID、checkpoint ID
- checkpoint digest、evidence digest
- owner 與必要的 affected module IDs
- freshness 狀態
- 按需重新取得完整證據的指令

雜湊只根據正規化後的結構化 metadata 計算，不含 prompt、模型私有推理、秘密、token 或未送出的輸入。引用不存在、雜湊不符、HEAD／檔案輸入變更或證據互相矛盾時，才重新呼叫 `resolve_task`、`orchestration_plan` 或 `context_pack`。

### Privacy-safe telemetry

每輪 telemetry 僅允許：

- input、cached input、cache-write input、output、reasoning output tokens
- bounded context bytes 與估算 tokens（標明 estimated）
- compaction 狀態：`observed`、`not-observed` 或 `unknown`，以及可取得時的次數／原因代碼
- routing class、owner、reference IDs、時間與 runtime 回合 ID

不得記錄 prompt body、附件內容、私密推理、環境變數、憑證、完整檔案路徑或工具輸出。沒有 runtime 證據時使用 `unknown`，不能推測為零或未發生。

### Context 與 checkpoint

採 warning-only 的既有本機 budget，但在接近門檻前先保存精簡 checkpoint。Checkpoint 沿用 work-registry 的有界欄位，增加 stable ID/digest；只保存變更檔名、Git branch/HEAD、驗證摘要、剩餘風險與下一任務。Compaction 後以 reference 恢復，不把完整舊 context 再注入。不得自動刪除 session 歷史。

### Repository 與 AGENTS 邊界

Operational turn 留在既有 runtime/session context，不因舊 plan 重新選擇遊戲 repository，也不建立新的跨模組寫入 scope。只有 development turn 或明確 owner 才重新選擇 execution workspace。測試需證明 token／服務／進度問題不會把先前 Lumen 等模組加入 plan。

### Process lifecycle

Bridge process 留在 `codex-discord.service`。Codex app-server／長時間工作負載透過可設定的 systemd user transient scope 啟動，使工作負載 cgroup 與 bridge service 分離。實作需：

- 保留 stdin/stdout/stderr 管線與退出碼。
- unit 名稱有界、不可注入 shell。
- systemd scope 不可用時採明確記錄的 direct-spawn fallback。
- Bridge 重啟測試使用假 process/systemd adapter；不得以目前 GPU client 作實驗。
- 不以 cgroup 分離宣稱 orphan cleanup；取消與明確 shutdown 仍走既有 lifecycle。

## 微任務總表

| ID | 狀態 | 主要概念 | 目標 | 聚焦驗證 | 完成條件／停止邊界 |
| --- | --- | --- | --- | --- | --- |
| C0 | 完成 | 企劃基線 | 固化範圍、證據、順序與安全邊界 | 文件檢查、Git diff | 企劃可獨立審查；停止，不改 runtime |
| C1 | 完成 | Turn 分類 | 修正 operational／ambiguous 不繼承舊 query | turn-routing unit tests、usage guard validator | token／服務／進度案例不再繼承舊 query；停止 |
| C2 | 完成 | 證據引用 | follow-up envelope 改用 task/checkpoint/evidence refs 與 freshness | token-efficiency、adapter validator | envelope 有界、無 prompt、digest 改變可辨識 stale evidence；停止 |
| C3 | 完成 | Telemetry contract | 統一 privacy-safe token/context/compaction telemetry | adapter 與 Discord formatter tests | 欄位齊全、未知值不偽造、秘密測試通過；停止 |
| C4 | 完成 | 提前 checkpoint | 壓力門檻前保存可恢復 checkpoint | usage-guard/session-store/runtime tests | checkpoint 可恢復、同 turn 去重且不複製完整歷史；停止 |
| C5 | 完成 | Workspace 邊界 | operational turn 不切 repo、不擴大 AGENTS/scope | runtime routing integration tests | 既有 session 可回答操作問題且無遊戲模組寫入；停止 |
| C6 | 完成 | Cgroup 隔離 | 加入 transient scope adapter 與安全 fallback | spawn mock、lifecycle tests、systemd dry probe | 工作負載與 bridge unit 可分辨；不碰現有 GPU client；停止 |
| C7 | 完成 | 整合文件 | 更新 README、service 範例與 token 文件 | codex-discord tests、workspace/intelligence validators | 文件與實作一致；停止 |
| C8 | 完成 | 獨立複核 | 檢查 routing/privacy/lifecycle regressions | 獨立 diff review、impact、test plan | 無未處理重大問題；停止，不發布 |

## 微任務契約

### C1 — Turn 分類

- **goal**：將操作性問題從舊開發 scope 中分離。
- **primaryConcept**：turn intent classification。
- **readScope**：`turn-routing.mjs`、`task-intent.mjs`、routing validators。
- **writeScope**：上述 routing 實作與直接測試。
- **focusedValidation**：新增中文與英文 token、usage、service、status、progress、restart 診斷案例；驗證明確「繼續」仍續接。
- **doneCriteria**：非程式問題不串接舊 query，且不產生遊戲模組 scope。
- **stopBoundary**：不修改 follow-up envelope 或 telemetry。

### C2 — 證據引用

- **goal**：用有界 reference 取代續接時的重複語意內容。
- **primaryConcept**：checkpoint/evidence identity。
- **readScope**：`orchestration-context.mjs`、`task-evidence.mjs`、`work-registry.mjs`、adapter。
- **writeScope**：reference builder、adapter glue、直接 validators。
- **focusedValidation**：長輸入、重複 module、惡意字串、stale digest、缺失 checkpoint。
- **doneCriteria**：envelope 固定上限且不包含 prompt；有效 reference 可沿用，失效 reference 觸發有界重取。
- **stopBoundary**：不改 usage 顯示或 process 啟動。

### C3 — Telemetry contract

- **goal**：提供真實、可區分、不可洩密的 token/context/compaction 資料。
- **primaryConcept**：privacy-safe runtime telemetry。
- **readScope**：activity adapter、agent adapter、runtime events、Discord formatter。
- **writeScope**：telemetry normalizer、事件與顯示、直接測試。
- **focusedValidation**：snake/camel 欄位、缺值、重複事件、secret fixture、compaction 未知狀態。
- **doneCriteria**：數值來源可追溯，無 prompt/secret，Discord 顯示不把估算當實測。
- **stopBoundary**：不改 checkpoint threshold。

### C4 — 提前 checkpoint

- **goal**：在高 context 前留下足以恢復的短 checkpoint。
- **primaryConcept**：budget-triggered persistence。
- **readScope**：usage guard、work registry、runtime lifecycle。
- **writeScope**：checkpoint trigger、persistence glue、直接測試。
- **focusedValidation**：只觸發一次、observe/enforce 差異、重啟恢復、無歷史刪除。
- **doneCriteria**：checkpoint 早於硬停止且欄位有界。
- **stopBoundary**：不改 cgroup。

### C5 — Workspace 邊界

- **goal**：避免操作性 turn 造成 repository/AGENTS scope 膨脹。
- **primaryConcept**：execution workspace stability。
- **readScope**：runtime workspace selection、adapter、Discord workspace handling。
- **writeScope**：workspace selection 與整合測試。
- **focusedValidation**：在 Lumen session 後詢問 token、status、service；不得新增遊戲模組 write root。
- **doneCriteria**：operation turn 使用既有安全 workspace，無跨模組 scope 擴張。
- **stopBoundary**：不改 service lifecycle。

### C6 — Cgroup 隔離

- **goal**：使 bridge restart 不以 service cgroup 連帶管理長時間工作負載。
- **primaryConcept**：process ownership boundary。
- **readScope**：runtime spawn、codex-discord config/index、service 文件。
- **writeScope**：spawn adapter、設定、測試與 service 範例。
- **focusedValidation**：mock transient scope、fallback、signal、stdio、unit-name validation；只讀 `systemctl show` probe。
- **doneCriteria**：新工作負載有獨立 cgroup 證據；fallback 清楚；未啟動/重啟 GPU client。
- **stopBoundary**：不重啟正式 DC service。

### C7 — 整合文件

- **goal**：讓運維與限制與實作一致。
- **primaryConcept**：operator contract。
- **readScope**：README、token-efficiency、service sample、changed files。
- **writeScope**：相關文件與必要 validator assertions。
- **focusedValidation**：codex-discord unit suite、workspace/intelligence/adaptive orchestration validators。
- **doneCriteria**：設定、fallback、telemetry 語意、無發布/重啟限制均有文件。
- **stopBoundary**：不 commit/push/publish。

### C8 — 獨立複核

- **goal**：由與實作者分離的審查路徑檢查安全與回歸。
- **primaryConcept**：independent verification。
- **readScope**：最終 diff、impact、test plan、測試證據。
- **writeScope**：只修複核發現且回到對應微任務；否則唯讀。
- **focusedValidation**：routing、privacy、session recovery、service lifecycle、fallback。
- **doneCriteria**：重大發現清零，剩餘限制記錄完整。
- **stopBoundary**：不 commit/push/publish。

## 驗證與風險

每次修改只跑直接測試；最終再執行受影響的 codex-discord suite、`validate-agent-adapter`、`validate-token-efficiency`、`validate-usage-guard`、`validate-adaptive-orchestration`、`validate-intelligence` 與 `validate-workspace`。若 impact/test plan 要求更多固定檢查，再補其必要項，不重跑未變輸入的成功結果。

主要風險是把真正的短續接誤判成新任務、把 runtime 未提供的 compaction 狀態當成已知、reference 過期仍被沿用，以及 systemd fallback 在非 Linux 環境失效。所有路徑應 fail bounded：保留安全限制、要求重述或重新取得證據，不能靜默擴大 scope。

## Checkpoint

- **taskId**：C8
- **repositoriesTouched**：TotemWorkspace
- **branch**：`ci/validation-ownership`
- **head**：`03286a3`
- **filesChanged**：30 個工作樹檔案，涵蓋 bounded context/routing、telemetry/checkpoint、process scope、Discord session/lifecycle、設定與文件，以及對應 validators/tests；本企劃納入最終狀態與證據。進場前既有修改仍保留來源區分。
- **validation**：獨立審查使用 `gpt-5.6-sol` medium，結論為沒有可採取的正確性缺陷。codex-discord 完整 suite 128 項通過；`validate-workspace` 1619 checks、`validate-intelligence`、`validate-adaptive-orchestration`、`validate-agent-adapter`、`validate-token-efficiency`、`validate-usage-guard`、`validate-work-registry` 均通過。Impact 僅有 `totem-workspace`、風險為 `runtime-security`；test plan 要求的 workspace、intelligence、adaptive orchestration、agent adapter 與 affected runtime surface 均有實際證據。
- **remainingRisks**：目前執行中的 DC service 未重啟，新 source/config 尚未套用現行 process；systemd scope 僅有 mock 與無副作用 dry-probe 邏輯證據，未在本輪重啟真實 user service。沒有 commit、push 或發布授權。
- **nextTask**：無；等待明確授權後於閒置窗口重啟 DC service 使修改生效。

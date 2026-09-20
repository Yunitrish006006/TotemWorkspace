# 減少重複讀取的固定入口

## 1. 工具輸出

MCP 預設 `response_detail: "compact"`，CLI 預設 compact；移除 context pack 的重複 `rendered` 表示及 orchestration 的相同 `executionWaves` 別名，並縮排壓縮。保留 `waves`、全部執行／安全／發布約束、風險、驗證與獨有證據。MCP 的資料只放在 `structuredContent`；文字僅提示資料位置，不再重複整包 JSON。客戶端必須讀取 structuredContent；純文字需求使用 CLI。

需要舊診斷欄位時，MCP 使用 `response_detail: "full"`，CLI 加 `--full`。這是傳輸層變更，既有 Bridge／runtime 使用的核心物件不因精簡而丟失欄位。已啟動的 MCP server 要重新載入程式才會使用新格式。

Context pack 預設 3,000 近似 tokens；先減少程式碼檢索片段，不截斷結構化安全／執行約束。必要約束超過預算時以 `constraintsExceedBudget` 明示；這是目標預算，不是假稱的硬上限。Runtime developer instructions 只攜帶必要約束和本次模型選擇，不嵌入完整 plan、rationale、catalog 或 quota 明細；完整證據仍可按需取得。

## 2. 限定檢索

已知工作擁有者時，`resolve_task`、`orchestration_plan`、`context_pack` 傳入 `module_id`。CLI 的 resolve、orchestrate、context 可加 `--module`：

```sh
node scripts/totem-intelligence.mjs resolve "調整 CI 驗證輸出" --module totem-workspace
node scripts/totem-intelligence.mjs context "調整 CI 驗證輸出" primary --module totem-workspace
```

明確 focus 限制模糊命中；明確提到的其他模組仍保留，之後由既有 impact 加入受影響消費者與必要約束。Workspace tooling 不需要刷新整套遊戲模組索引。沒有足夠資訊時維持原本自動解析，不能為省 token 猜測縮小風險範圍。

README 錯字與有界唯讀查詢不因全域模組描述而升級成全套變更。單模組低風險任務用一個 bounded-task 階段；階段不是代理。未知 README 擁有者不猜整個 workspace，先確認目標。功能／契約／安全變更及混合請求保留 impact、必要驗證與獨立審查；來源檔案變更不能冒充文件修改。

## 用量護欄與工作方式

- 合併同一批唯讀查詢；工具只輸出必要欄位，完整 log 留在檔案。等待同一個 CI run，不反覆讀取沒有變動的結果；失敗才取該步驟 log。
- 主線保留整合決策；只在輸入、檔案、驗收條件可界定、工作可隔離且節省超過啟動成本時委派。必要獨立審查例外，但仍只帶有界上下文，不繼承整段對話。
- 共用 runtime 在觀察到 40 次工具操作或 48K input context 時發出 checkpoint；80 次或 64K 時中斷並回報未完成，不自動重播。CLI 直跑由 AGENTS 工作規則約束，不宣稱有同樣的程式硬限制。
- Input/output 比超過 100 且 input 至少 20K 時一次告警；不以比值單獨判定失敗。token totals 採 runtime 回報的 thread 累計值，不把逐次累計再相加。重複工具 ID 不重算。
- `usageSummary` 區分觀察到的工具次數、未知的模型輪數、回報模型與要求 effort。Discord 顯示摘要；沒有 turn_context 證據就不輸出逐輪模型分佈。快取 token 不是零成本的證據，token 也不是帳單金額。
- 輕量模型在 catalog 宣告支援時使用 low／medium；不延續舊的 xhigh 偏好。實際跨模組契約、安全或證據衝突才升級。Spark 不在可用清單時不得硬編不存在的模型；本機已列出的 Luna 可作替代，但不能宣稱使用 Spark 獨立配額。
- 不因省 token 降低 sandbox、寫入／外部動作核准或發布驗證。`approval_mode="approve"` 不等於已證明每次詢問；未重現前不改權限。設定欄位依 [官方 MCP 文件](https://developers.openai.com/codex/mcp) 核對。

## Session 保存與生效邊界

`node scripts/session-storage-report.mjs` 只讀檔案大小／時間，報告總量與超過 90 天的數量，不讀對話內容、不刪除檔案。保留最近 90 天的輪替僅為待核准政策；先備份並排除仍在使用的 session，再另行授權清理，不部署自動刪除 timer。

目前 source 修改需重新啟動相關 MCP／Discord runtime 才生效；不得為此打斷進行中的任務。全域 Codex 預設模型僅影響後續選擇，不代表既有對話已切換模型。服務重啟、push 與任何模組上架都不包含在本次最佳化內。

## 3. 任務證據摘要

在目標 repository 執行 `task-evidence.mjs`，用 ignored `.totem-index/task-evidence/` 保存短摘要及明確列出的原始碼／設定 SHA-256、Git HEAD：

```sh
node scripts/task-evidence.mjs save ci-output /tmp/ci-notes.json mcp/server.mjs intelligence/tool-output.mjs
node scripts/task-evidence.mjs read ci-output
```

Notes JSON 只使用 `findings`、`decisions`、`validation`、`pending` 四個字串陣列。使用短結論、相對路徑與公開 CI 證據連結，不複製完整 log，不記錄密鑰、私密輸入或權限授予。外部模組可使用工作區工具的絕對執行路徑，但 cwd 必須是該 repository。

儲存前以 `git check-ignore` 確認記錄不會被 Git 納入；未忽略時明確拒絕。可先在該 repository 的本機 `.git/info/exclude` 加入 `.totem-index/`，不需要為私人摘要修改共用 `.gitignore`。

`current` 僅代表 HEAD 與列出的檔案未變；沒有列入的相依、外部狀態與測試範圍不在保證內。Git HEAD 或檔案改變後回傳 `stale` 並 exit 2，舊結論僅供定位。摘要中的驗證敘述是紀錄，不能替代 CI 的真實來源／結果，亦不能建立發布授權。

## 4. 單一規則來源

驗證分工統一維護在 [validation-ownership.md](validation-ownership.md)。工作區根與 repository 的 AGENTS 只保留入口與特殊要求。每個任務讀一次相關政策，後續沿用已取得的內容。

## 5. 發布前固定檢查

```sh
python3 scripts/release-preflight.py ../TotemAlchemy --report /tmp/alchemy-preflight.json
python3 scripts/release-preflight.py ../TotemAlchemy --jar ../TotemAlchemy/build/libs/totem-alchemy-VERSION.jar --expected-sha512 EXPECTED_HASH
```

一次列出版號、Minecraft／Java／Core 宣告、changelog、語言鍵與格式參數問題；傳入 JAR 時檢查檔名、metadata、禁止內容與 SHA-512。預設 stdout 最多顯示 20 個錯誤，`--report` 留完整結果，`--full` 可展開。

`Release source preflight` workflow 接受註冊中的 active module ID 及精確 source SHA，固定執行 source-only 檢查並保存報告，不執行建置或發布。此 workflow 是額外的共用檢查入口；既有各模組 publisher 尚未全部接入，不能宣稱其 artifact 檢查已由這個 source-only run 完成。此腳本目前採用 Totem 的 `~minecraft_version` 與 Java `>=25` 約定；特殊相容範圍須明確調整檢查。

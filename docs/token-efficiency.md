# 減少重複讀取的固定入口

## 1. 工具輸出

MCP 預設 `response_detail: "compact"`，CLI 預設 compact；移除 context pack 的重複 `rendered` 表示及 orchestration 的相同 `executionWaves` 別名，並縮排壓縮。保留 `waves`、全部執行／安全／發布約束、風險、驗證與獨有證據。MCP 的文字與 structuredContent 仍提供相同內容，兼容兩類客戶端。

需要舊診斷欄位時，MCP 使用 `response_detail: "full"`，CLI 加 `--full`。這是傳輸層變更，既有 Bridge／runtime 使用的核心物件不因精簡而丟失欄位。已啟動的 MCP server 要重新載入程式才會使用新格式。

## 2. 限定檢索

已知工作擁有者時，`resolve_task`、`orchestration_plan`、`context_pack` 傳入 `module_id`。CLI 的 resolve、orchestrate、context 可加 `--module`：

```sh
node scripts/totem-intelligence.mjs resolve "調整 CI 驗證輸出" --module totem-workspace
node scripts/totem-intelligence.mjs context "調整 CI 驗證輸出" primary --module totem-workspace
```

明確 focus 限制模糊命中；明確提到的其他模組仍保留，之後由既有 impact 加入受影響消費者與必要約束。Workspace tooling 不需要刷新整套遊戲模組索引。沒有足夠資訊時維持原本自動解析，不能為省 token 猜測縮小風險範圍。

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

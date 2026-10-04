# 原生 Codex 對話的任務分配

直接在 Codex CLI／IDE 對話中提出 Totem 任務。既有 intelligence skill 會在工具可用時接入三個 MCP 工具，不需要啟動獨立 runtime CLI：

| 工具 | 用途 |
| --- | --- |
| `allocation_start` | 建立任務 ID，從實際可列出的模型取得分配建議，回傳範圍與原有約束 |
| `allocation_status` | 查詢摘要，或回報目前階段 |
| `allocation_feedback` | 每個任務保存一次不可覆寫的結果回饋 |

對話摘要使用任務分配、進度、結果三種呈現；沒有新增原生 CLI 面板或斜線指令。工具回傳 compact structuredContent，由 Codex 以使用者語言呈現，不重複整包 JSON。

## 起始策略

有界唯讀與機械工作優先可用 Luna／Spark；一般實作優先可用 Sol；既有 plan 要求的高風險判斷保留強推理層。Sol 中間層依 catalog 的 balanced capability 或 Sol family 辨識，同層優先可用的新版本，因此 GPT-6.1 Sol 只有在目錄列出時才會納入。Explicit model/effort 偏好仍由共同路由依配額、輸入、context 與風險約束處理。

模型目錄短暫快取，並合併同時進行的讀取；失敗目錄不捏造模型。此策略不切換宿主主模型、不啟動模型回合、不派生代理。

## 每次任務的回饋

紀錄只保存 task ID、政策版本、粗略任務類型、模組、比較維度、目錄建議與列舉式回饋。不保存 prompt、prompt hash、URL、source bodies 或自由文字。存放於 Git-ignored `.totem-index/native-allocation/`，拒絕逃逸／symlink、超大紀錄與重複 terminal feedback。

在相同政策版本、任務類型、模組／契約／風險／驗證要求中，最近三十天至少五筆品質回報且兩筆品質失敗，會對下次任務提供向上一層的建議。這是保守的起始實驗門檻，不是已證明的可靠度。環境故障、取消、配額不足與未完成工作不納入品質統計；不自動降級、不重新執行寫入、不降低權限或驗證要求。

原生 MCP 呼叫沒有宿主的可信 execution telemetry。實際模型、實際 effort、實際用量因此顯示 unknown；caller 回報的模型另標為 reported，即使與建議相同也不變成實際證據。`success` 加上 `passed` 回報仍是 `awaiting-evidence`，不能宣稱已通過完成 gate。既有 CI／獨立審查來源仍須依 validation-ownership 核對，不能用此紀錄替代。此版只提供基於回報的向上建議，不對模型品質作已驗證的排名。

上限五百筆紀錄；達上限明確拒絕新增，不自動刪除任務或 session history。較舊紀錄可查詢但不影響分配。自適應僅改變 advisory preference，既有 runtime、宿主與執行約束仍擁有控制權。

## 生效與驗證

新增工具需要 Codex 重新連接 MCP；不打斷正在執行的任務。已開啟工作階段若未看到工具，下一次啟動 Codex 後使用。`validate.yml` 負責 model-policy 與 native-allocation validators；本機可用小範圍測試取得開發回饋。獨立 runtime CLI 不在本次開發範圍。

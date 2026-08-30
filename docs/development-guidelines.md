# Totem 開發注意事項

## 平台與模組邊界

- 基線為 Minecraft 26.2、Java 25、Fabric Loader 0.19.3+ 與對應 Fabric API。
- 共用契約放 TotemCore；玩法資料、Screen、資源、權限與生命週期由功能擁有模組維護。
- 不為方便而複製另一個模組的實作類別或遊戲資料。跨模組協作使用版本化 Core 契約、穩定公開 API 或明確的 runtime adapter。
- 軟依賴未安裝時必須安全降級。安全與權限 API 若已宣告存在卻無法載入，採 fail closed，避免繞過保護。
- 所有玩家物品、容器、權限、成本、交易與世界變更由伺服器再次驗證；客戶端只提供意圖與呈現。
- 實體 AI、掃描、路徑、網路同步及外部呼叫都要有明確上限、共享預算、快取或退避。不得用無界掃描或阻塞 I/O 佔住伺服器 tick。

## Observer UI 所有權

- 新增或更動任何可轉播的 production Screen 時，擁有該 Screen 的模組必須同時提供自己的 Observer provider。
- Vanilla family 必須建立相符的 Mojang Screen／Menu；合作模組必須走擁有模組的正式 production rendering path。禁止手繪 lookalike、mirror Screen、反射複製 renderer。
- Provider 透過 TotemCore API 暴露有界、版本化的 semantic snapshot，並以 family、variant、protocol 精確協商。
- Capture／create、Screen handle 與 apply 都在 Minecraft client thread 執行；Client GameTest 使用 client-thread context helper，不得直接從 GameTest thread 呼叫。
- Snapshot 與 cursor sequence 只接受單調遞增資料；關閉、切換 family／variant／protocol 時清除舊序列與 carried state。
- 轉播畫面必須禁止本機滑鼠、鍵盤、menu mutation 與封包，唯一例外是明確的停止觀察操作；仍須顯示遠端游標與 carried stack。
- Observer 永遠 framebuffer-free：禁止傳送 framebuffer、screenshot、video，亦不得加入任何像素擷取 fallback。
- 必須遮蔽未送出的聊天／指令，以及 secret、credential、API key、token、password、URL、prompt 與相近私人輸入。
- 擁有模組提供 module-present coverage：初始狀態、後續更新、輸入／封包抑制、遠端游標、關閉生命週期及 rendered screenshot。
- TotemVanillaTweaks 保留 module-absent coverage：缺少或不相容 provider 時只回報 unsupported metadata，不創造替代 UI。

## UI、視覺與文字

- 優先使用原版 Screen、widget、slot、字型、tooltip、narration、音效、焦點順序及整數座標。
- 模組 icon 以共同 16×16 Totem 輪廓與各自 emblem 區分；runtime 64×64 版本只能是 4× nearest-neighbor 放大。
- 道具與方塊維持原版像素密度、透明背景、整數像素、左上光源與材料語彙；禁止模糊縮放或抗鋸齒邊緣。
- 不把翻譯文字烘焙進 texture，也不在 Java 或 JSON 畫面模型中硬寫玩家可見句子。使用 language key，並驗證英文與繁體中文的碰撞、裁切與 tooltip。
- 新增或修改視覺資產時，依專案的 Totem art-direction 驗收清單檢查；16×16 資產先過嚴格像素驗證，再繼續整批製作。

## 測試與驗證

- 變更前先確定擁有者與契約；變更後執行該模組已有的 compile、unit、GameTest、Client GameTest、整合、E2E 或 runtime probe（依功能適用）。
- Observer 變更必須證明 framebuffer-free、server relay validation、協定／variant 拒絕、單調序列、輸入與封包抑制、隱私遮蔽及 close cleanup。
- 不得用增加固定 sleep 掩蓋 race。CI 失敗時看 log、修根因、push 並重跑相關檢查。
- 一個 semantic family 完整實作、驗證、合併後才開始下一個；一個 PR 不塞入無關 family 或大規模 reformat。

## Secret、設定與日誌

- Repository、artifact、截圖、Observer snapshot、測試 fixture 與 log 都不得包含真實 secret、API key、token、password、Webhook、私密 URL 或個資。
- Secret 只透過部署環境、GitHub Actions secret、伺服器私密設定或外部 secret store 注入。公開範例使用明顯假值。
- 管理介面不可回傳既有憑證；錯誤訊息與稽核事件只包含診斷所需的最少資料。

## Git 與 CI

- 從最新預設分支建立小而單一目的的 branch；避免無關 reformat 與跨模組混雜提交。
- 發布前確認工作樹乾淨、本機 branch 與 upstream 同步、版本與 Core 範圍一致、artifact 可重現。
- 不以「已 push」推論 GitHub Actions 全綠，也不以「Actions 全綠」推論 Modrinth 已發布；三者分別查證。
- CI 不持續輪詢；只在狀態改變或需要處理失敗時查看。紅燈要讀 log、修正、push、重跑，不能停在失敗狀態。

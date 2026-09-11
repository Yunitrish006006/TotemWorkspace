# Totem 發布檢查表

驗證分工依 [validation-ownership.md](validation-ownership.md)：固定程序由 GitHub Actions 執行，成功結果直接沿用；本機僅跑修改或診斷所需的最小檢查。

每個模組的 Gradle task 與測試拓撲不同；以下標示「適用時」的項目，必須依該 repository 實際提供的工作執行，不能用不存在的 task 代替證據。

## 原始碼與版本

- [ ] 所有 Gradle、測試、GameTest、runtime probe、`remapJar` 與發佈命令都使用 JDK 25；執行前 `java -version` 與 `./gradlew -version` 都回報 JVM 25。
- [ ] `fabric.mod.json`、`gradle.properties`、artifact 名稱與發布版本一致。
- [ ] Minecraft、Java、Fabric Loader／API 及 TotemCore 相容範圍正確。
- [ ] 所有硬依賴與 `suggests` 符合實際程式路徑；未安裝軟依賴的降級已驗證。
- [ ] `git status` 乾淨，預設分支與 upstream 同步，預定 commit 已 push。
- [ ] Release notes、README、語言檔、手冊與跨模組總表已反映玩家可見變更。

## 必經發布順序

對於要交付的現役模組版本，依下列順序完成；不能用「已經 build 過」或「已 push」取代後續證據。

1. 決定新的、尚未發布的模組版本，更新 version metadata 與相容範圍。
2. 先完成固定版本／相依設定 preflight；本機僅執行必要的針對性檢查。
3. Commit 並 push 精確的 source 與 version 變更到該模組的預設 GitHub branch，等待必要 CI 全綠。CI 使用 JDK 25 執行實際存在且本次變更需要的 build、unit test、GameTest、整合／runtime probe；沿用相同來源、相依、設定與範圍的成功結果。
4. 由固定程式檢查 production JAR 的名稱、版本、metadata 與 SHA-512，記錄其 source SHA、run 與 artifact。發布優先使用這份已驗證產物；仍會重建的既有 publisher 必須保留原有驗證，直到完成安全的 artifact 交接。
5. 以模組擁有的 `Publish Modrinth` workflow 發布；production publish 只在必要 CI 綠燈及發布已獲授權後執行。試跑只在該 workflow 要求或發布設定有待驗證時執行，不重複跑同一份完整測試。
6. 由發布 workflow 以 Modrinth API 回讀 project、version、Minecraft、loader、primary JAR 與 SHA-512，寫回 `modrinth-published-<version>.json`。Agent 確認該 run 與紀錄即可；沒有失敗或矛盾證據時，不另行下载、重建或重做 API 回讀。

若沒有使用者授權、Modrinth credential、正確 project 設定或可用 workflow，必須把版本狀態明確列為 blocker；不可稱模組更新已完成。

## 建置與測試

- [ ] Compile 與 unit tests 通過。
- [ ] Server GameTests 通過（適用時）。
- [ ] Client GameTests 通過（適用時）。
- [ ] 整合 loopback、三 JVM E2E 與 Production Runtime probe 通過（適用時）。
- [ ] Observer 路徑通過 framebuffer-free 檢查；沒有 screenshot、framebuffer 或 video 傳輸。
- [ ] Semantic family 的 protocol／variant、server relay validation、sequence cleanup、input／packet suppression、remote cursor 與 close lifecycle 通過。
- [ ] Module-present provider coverage 與 TotemVanillaTweaks module-absent unsupported-metadata coverage皆通過（適用時）。
- [ ] Screenshot artifact 已由固定程序產生；尺寸、markers、語意狀態、游標、carried stack 與隱私遮蔽由可自動判定的斷言檢查。人工只核對受影響畫面的外觀、文字可讀性與裁切（適用時）。
- [ ] 沒有用增加固定 sleep 掩蓋 race。

## Artifact 與發布

- [ ] CI／publisher 已以固定程式核對實際 artifact 的檔名、版本、模組 metadata、Core 範圍與必要資源；無矛盾證據時不要求 agent 另行下載。
- [ ] Artifact 不包含測試資源、私密設定、secret、local path、build cache 或其他模組內容。
- [ ] GitHub Actions 的必要 jobs 全綠；失敗已讀 log、修根因並重跑。
- [ ] Modrinth 專案 ID、相容版本、loader、依賴宣告與 changelog 正確。
- [ ] Modrinth publish secret 已在目標 repository 設定且 workflow 有權讀取。
- [ ] 發布所需 preflight 已通過；由成功的發布與 API 回讀 job 證明完成，不以單純 workflow 已觸發推論，也不重複人工驗證。

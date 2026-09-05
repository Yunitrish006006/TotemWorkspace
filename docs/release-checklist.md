# Totem 發布檢查表

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
2. 使用 JDK 25 跑該模組實際存在的 build、unit test、GameTest、整合／runtime probe。
3. 檢查 remapped JAR 的名稱、版本、metadata 與 SHA-512，確認沒有未預期內容。
4. Commit 並 push 精確的 source 與 version 變更到該模組的預設 GitHub branch，等待必要 CI 全綠。
5. 以模組擁有的 `Publish Modrinth` workflow 發布；workflow 支援時先 dry run，production publish 只在 CI 綠燈及發佈已獲授權後執行。
6. 以 Modrinth API 回讀 project、version、Minecraft、loader、primary JAR 與 SHA-512；確認或寫回 `modrinth-published-<version>.json`，並 push 尚未由 workflow 推回的 marker。

若沒有使用者授權、Modrinth credential、正確 project 設定或可用 workflow，必須把版本狀態明確列為 blocker；不可稱模組更新已完成。

## 建置與測試

- [ ] Compile 與 unit tests 通過。
- [ ] Server GameTests 通過（適用時）。
- [ ] Client GameTests 通過（適用時）。
- [ ] 整合 loopback、三 JVM E2E 與 Production Runtime probe 通過（適用時）。
- [ ] Observer 路徑通過 framebuffer-free 檢查；沒有 screenshot、framebuffer 或 video 傳輸。
- [ ] Semantic family 的 protocol／variant、server relay validation、sequence cleanup、input／packet suppression、remote cursor 與 close lifecycle 通過。
- [ ] Module-present provider coverage 與 TotemVanillaTweaks module-absent unsupported-metadata coverage皆通過（適用時）。
- [ ] Screenshot artifact 已產生，並人工核對畫面 markers、PNG 尺寸、文字、游標、carried stack 與隱私遮蔽（適用時）。
- [ ] 沒有用增加固定 sleep 掩蓋 race。

## Artifact 與發布

- [ ] 下載實際 CI artifact，核對檔名、版本、模組 metadata、Core 範圍與必要資源。
- [ ] Artifact 不包含測試資源、私密設定、secret、local path、build cache 或其他模組內容。
- [ ] GitHub Actions 的必要 jobs 全綠；失敗已讀 log、修根因並重跑。
- [ ] Modrinth 專案 ID、相容版本、loader、依賴宣告與 changelog 正確。
- [ ] Modrinth publish secret 已在目標 repository 設定且 workflow 有權讀取。
- [ ] Dry run 或權限探測成功後才發布；發布完成後再查證 Modrinth 版本頁與檔案，而不是依 CI 觸發推論。

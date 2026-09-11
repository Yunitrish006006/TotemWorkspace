# 驗證分工與結果沿用

驗證由固定程式判定，GitHub Actions 負責完整執行，agent 負責修改、定位失敗與必要的視覺判讀。每項要求先指定一個主要執行來源；「需要驗證」不等於「本機與 CI 各跑一次」。

## 現有工作區分工

| 檢查 | 主要來源 | agent 的工作 |
| --- | --- | --- |
| 工作區資料、契約、intelligence、Node API 與語意規則 | `validate.yml` 的既有固定 validators | 閱讀結果；失敗時才定位對應檢查 |
| Flutter analyze、test、兩種 base-href 建置 | `flutter-viewer.yml` | 修改時跑必要的小範圍檢查；沿用 CI 完整結果 |
| 模組 compile、unit/server/client GameTests、持久化、權限、Observer 協定與 runtime probe | 各模組既有 Build / Production Runtime workflows | 缺少自動化時把可重現步驟收進腳本與對應 workflow |
| 版本、相依範圍、語言鍵、格式參數、JAR metadata、SHA-512 | 各模組固定 preflight / artifact validator | 對新規則補固定判斷，不逐次手工解析 |
| Modrinth 上傳與 API 回讀 | 各模組 Publish Modrinth workflow | 確認精確 run 成功與發布紀錄；不再平行做另一套回讀 |
| 截圖產生、尺寸、語意狀態與輸入抑制 | client GameTests / 固定腳本 | 使用 CI 產生的截圖 |
| 美術一致性、可讀性、遮擋、裁切等外觀 | 必要的人／模型視覺審查 | 只看受影響畫面；保留一次審查結果 |

表內模組分類是分工要求，不宣稱每個模組已具備全部檢查。修改到對應流程時補足缺口；不可用表格代替實際 job 證據。Pages 的部署檢查會使用更新中的跨模組資料，屬不同輸入的驗證，本次保留。

## 一次驗證的證據

以 source SHA、相依 SHA、工具鏈／設定、檢查範圍、run/job URL 和結論辨識一次驗證。發布還須綁定 artifact ID 與 SHA-512。PR merge SHA 與 branch SHA 不可混用；`skipped`、`cancelled`、找不到 run 都不是成功。

相同輸入與範圍的成功結果直接沿用。只有相關輸入改變、失敗、結果缺失或具體新疑點才重新執行；先說明原因，只重跑受影響項目。若 CI 不可用，本機固定程序可作替代證據，但必要的發布 CI gate 仍須通過。

CI 完整矩陣保留不同平台、JDK、Node 或 runtime 拓撲的必要覆蓋，不能把不同環境當成重複測試。同一分支被新提交取代的驗證可取消；正在準備發布的提交若被取消，必須重新取得它所需的成功證據。

## 發布產物

目標是 CI 建置並檢驗一次 JAR，publisher 下載同一次 run 的不可變 artifact。下載前驗證 repository、source SHA、workflow/job 成功、相依版本與 artifact 身分，下載後由程式驗證 SHA-512；不能使用無來源約束的 latest artifact。Artifact 過期或缺失時明確失敗，再建置所需來源，不冒用其他 run。

目前仍會重新建置的 publisher 尚未全部轉換；修改它們時逐一建立這個交接，不直接刪除既有保護。自動化試跑與正式發布應共用同一 preflight；不要為了人工確認而再跑完整測試。

## 修改與觀察

先讀現有 workflows，選最小本機檢查，集中完成版本與發布設定修正後再推送。正常情況只讀一次精簡 workflow 結論；執行中沿用同一 run，不重新觸發。失敗才讀該 job 的 log，修正後重跑必要部分。不要為本次政策／文件調整而重建所有 Minecraft 模組。

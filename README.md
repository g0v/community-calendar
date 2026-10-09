# g0v 社群行事曆

g0v 社群活動的入口：什麼時候、在哪裡、能不能訂閱。

網站：<https://g0v.github.io/community-calendar/>（[活動搜尋](https://g0v.github.io/community-calendar/events/)、[月曆](https://g0v.github.io/community-calendar/calendar/)、[訂閱](https://g0v.github.io/community-calendar/subscribe/)）

## 資料來源

| 來源 | 收什麼 | 存在哪 |
|---|---|---|
| 揪松團「[大松小松活動訊息](https://g0v.hackmd.io/@jothon/event)」共筆 | 社群自由填寫的所有活動 | 這個 repo 的 `events/`，每天同步、累積保存 |
| [AI Monday](https://g0v.github.io/AI-Monday/) 工作小組的 Sheet（[data.civictech.tw](https://data.civictech.tw/v0/aimonday/events.json)） | AI Monday、國會松、COSCUP 的 AI 議程 | 不存在這裡，建置時讀取 |

同一場活動兩邊都有時（同一天、同一個系列），只顯示一筆：時間與講者以 AI Monday 的 Sheet 為準，並連到 AI Monday 的講題頁。講題、講者、錄影這些「講了什麼」留在 AI Monday 網站；「什麼時候、在哪」都在這裡。

## 搜尋與篩選

活動頁（`/events/`）可以搜尋活動名稱、地點、講者與共筆原文，並依時間（近期／過去）、揪松主辦、系列、地點（縣市或線上）篩選。條件會寫進網址，可以直接分享，例如 `?series=hackathon&when=all`。

系列、縣市、線上是程式從標題與地點推出來的（`scripts/facets.mjs`），推不出來就不標。

## 訂閱日曆

| 日曆 | 網址 | 收什麼 |
|---|---|---|
| 揪松團活動 | `https://g0v.github.io/community-calendar/jothon.ics` | 只有揪松團主辦的：黑客松（大松）、AI Monday、放輕松、跑咖松 |
| 所有社群活動 | `https://g0v.github.io/community-calendar/all.ics` | 共筆上的所有活動。共筆開放社群自由填寫，**內容未經審核** |

另外每個系列各有一份：`series/{系列}.ics`（例如 `series/hackathon.ics`），完整清單在[訂閱頁](https://g0v.github.io/community-calendar/subscribe/)。AI Monday 用它自己原本的 `https://g0v.github.io/AI-Monday/calendar.ics`，不另外產生，免得訂閱的人分散在兩個網址。

都只收日期確定到「哪一天」的活動。有子場次的大松（分城市辦）每個城市一個事件。

## 補回來的過去活動

每日同步從 2026-10-09 開始。在那之前就被清掉的活動，是從共筆的舊版本補回來的（`scripts/backfill.mjs`）：

- **HackMD 版本歷史**：公開的共筆不用登入就讀得到（`/{note id}/revision`），從 2024-12-15 起約 500 版，幾乎每次編輯都有一版
- **網路檔案館**（Wayback Machine）：2025-01 起 21 份存檔，是第一輪補資料用的，版本歷史涵蓋得更完整

這些資料帶有 `archive` 欄位，記錄最早與最晚出現在哪一版。2024-12-15 以前的共筆沒有版本可以讀。

在活動日之前就從存檔裡消失的，多半是改期或取消前的舊計畫，網站會標「共筆已移除」，月曆上畫刪除線。

## 跟共筆的關係：累積，不是鏡像

共筆會被定期清掉過期的活動，所以這裡**不是**「共筆長怎樣、資料就長怎樣」：

- 共筆上還在的活動：有改就跟著更新
- 共筆上不見的活動：**留著**，標上 `in_source: false` 與消失的日期。網站與日曆照常顯示
- 活動日還沒到就從共筆消失的（可能取消、也可能誤刪）：照常顯示，但標「共筆已移除」
- **一筆都不自動刪除**。要下架見下面的「管理員」

每天台灣時間 04:30 同步一次（`.github/workflows/sync.yml`）。

## 資料在哪

| 路徑 | 內容 |
|---|---|
| `events/{id}.json` | 一場活動一個檔案，由同步程式寫入。**這個檔案在 GitHub 上的 History 就是那場活動的修改紀錄** |
| `overrides/{id}.json` | 管理員的修正，人工維護。同步程式不會動它 |
| `/events.json`（網站上） | 開放資料：套用修正後、網站上看得到的每一筆 |
| `/report.json`（網站上） | 最近一次同步的檢查結果 |

`id` 在第一次看到這場活動時決定，之後不會變（就算標題、日期被改），網址與日曆的 UID 都靠它。所以 id 開頭的日期可能跟活動現在的日期不同，以檔案裡的 `date_start` 為準。

### 同步怎麼認出「同一場活動」

共筆誰都能改，標題、日期都可能被改，所以依可信度依序比對：

1. 報名／共筆／活動頁的網址相同，而且這個網址在共筆上只出現在這一筆（同一張報名表被好幾場共用是常態）
2. 同一天，且標題相似
3. 標題完全相同、日期不同（改期）：當成同一場，另外報一條提醒

都對不上就當成新的一筆。寧可多一筆讓人合併，也不要把兩場不同的活動默默合成一筆。

### 解析容錯，但不默默修

共筆上看起來有問題的地方（漏了 `---`、時間和地點的值對調、標題的日期跟「時間」欄對不上），會照原樣收進來，另外記一條提醒。提醒會出現在活動頁，也會彙整成一張標著「資料檢查」的 issue，處理好之後下一次同步自動關閉。

## 管理員

目前的管理員：哲瑋、Dong。管理員做的事都寫在 `overrides/{id}.json`：

```json
{
  "hidden": true,
  "jothon": true,
  "set": { "title": "正確的標題", "start_time": "19:00" },
  "note": "為什麼這樣改，給下一個管理員看"
}
```

| 欄位 | 作用 |
|---|---|
| `hidden` | `true`＝下架：網站與兩份日曆都不出現，活動頁變成 404。資料仍保留在 `events/`，改回 `false` 就恢復 |
| `jothon` | `true`＝揪松主辦，放進揪松日曆；`false`＝確認不是，不再提醒 |
| `set` | 蓋掉共筆解析出來的欄位。共筆那筆已經被刪掉、沒有地方可以改時用這個 |
| `note` | 備註，不會顯示在網站上 |

**揪松主辦只看這裡，不看共筆上寫的「主辦」**：共筆誰都能寫「主辦：揪松」，而揪松日曆是帶著揪松名義發出去的。標題看起來像揪松活動（黑客松、AI Monday、放輕松、跑咖松）但還沒確認的，會列在「資料檢查」issue 裡。

例外是 AI Monday：揪松團自己維護的 [AI Monday 資料](https://data.civictech.tw/v0/aimonday/events.json) 同一天也有一場，就自動當成揪松主辦，並沿用 [AI Monday 日曆](https://g0v.github.io/AI-Monday/calendar.ics) 的 UID。

### 最快的改法：活動頁的「編輯這筆」

每場活動頁都有「編輯這筆」，會直接在 GitHub 打開這場活動的修正檔（還沒有的話，打開新增檔案畫面，檔名與範本都填好）。改完按 Commit 就生效。沒有寫入權限的人按同一個按鈕，GitHub 會自動開成 PR，管理員合併即可——這也是外人提修改的管道。

**不要直接改 `events/{id}.json`**：活動還在共筆上的話，共筆下次一改就會整筆重寫，改過的東西會安靜地消失。

### 有人回報問題時

網站每一場活動都有「回報問題」，會開一張 issue。處理方式：

- 資料錯了 → 共筆還在就改共筆；共筆已經刪了，就在 `overrides/{id}.json` 用 `set` 修
- 活動取消、內容有害或不適合 → `overrides/{id}.json` 寫 `"hidden": true`

改完 push 到 main，幾分鐘後網站與日曆就會更新（訂閱的日曆依各家軟體的更新頻率，通常數小時內）。

## 共筆範本

放在共筆活動區最上面，請大家照著填，同步程式最好認：

```markdown
:::info
**新增活動請照這個格式**（這段是給 g0v 社群行事曆的同步程式用的，清理共筆時請保留）
每筆活動前後用 `---` 隔開；第一行是日期＋活動名稱，跨天寫 `2026-11-07~11-08`。
有報名表或共筆的話一定要附，那是辨認「同一場活動」的依據。

    2026-11-20 活動名稱
    - 時間：19:00-21:00
    - 地點：場地名稱
    - 地址：完整地址
    - 報名：https://…
    - 共筆：https://…
    - 主辦：主辦單位

分城市辦的活動，用「- 高雄場」往下縮排寫各場的時間、地點。
訂閱日曆：https://g0v.github.io/community-calendar/
:::
```

舊的寫法（`10/14 週三晚上 …`、`2026/11/08 Sun. …` 等）仍然認得，不必改。

## 開發

需要 Node.js 22.12 以上。

```bash
npm install
npm run sync     # 讀共筆、更新 events/、產生 report.json
npm run dev      # 開發伺服器
npm run build    # 輸出靜態檔到 dist/
```

用本機的共筆檔測試：`SOURCE_FILE=path/to/event.md TODAY=2026-10-09 npm run sync`

| 檔案 | 做什麼 |
|---|---|
| `scripts/parse.mjs` | 共筆 Markdown → 一筆一筆活動。只做文字轉換，不碰檔案與網路 |
| `scripts/sync.mjs` | 讀共筆、比對既有資料、寫 `events/` 與 `report.json` |
| `scripts/resolve.mjs` | 套上 `overrides/`、判斷揪松主辦、併進 AI Monday 的場次。同步與網站共用 |
| `scripts/facets.mjs` | 從標題與地點推出系列、縣市、線上 |
| `scripts/backfill.mjs` | 從共筆的 HackMD 版本歷史（或網路檔案館）補回過去的活動，可重複跑 |
| `scripts/data-check-issue.sh` | 把 `report.json` 同步成「資料檢查」issue |
| `src/lib/ics.ts` | 產生日曆檔 |

## 授權

- 程式碼：MIT
- 活動資料：來自社群共筆，授權尚未確認（待跟揪松團確認）

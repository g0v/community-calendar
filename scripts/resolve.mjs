// 把 events/（從共筆累積來的原始資料）套上 overrides/（管理員的修正），得到網站與日曆實際用的資料。
//
// 共筆誰都能編，所以兩件事**不讀共筆**，只讀 overrides：
//   - 下架：overrides/{id}.json 的 "hidden": true
//   - 揪松主辦：overrides/{id}.json 的 "jothon": true（共筆上寫「主辦：揪松」不算數）
// 唯一的例外是 AI Monday：揪松團自己維護的 AI Monday 資料（data.civictech.tw）同一天也有一場，
// 就當成已確認，不必每個月請管理員蓋一次章。
//
// overrides/{id}.json 的格式（每個欄位都可省略）：
//   {
//     "hidden": true,                 下架：網站與日曆都不出現（資料仍保留在 events/）
//     "jothon": true,                 揪松主辦：放進揪松日曆。false＝確認不是，不再提醒
//     "set": { "title": "…" },        蓋掉共筆解析出來的欄位
//     "note": "為什麼這樣改"          給下一個管理員看的，不會顯示在網站上
//   }

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// 揪松主辦的系列（2026-10-09 定）：大松、AI Monday、放輕松、跑咖松。國會松與小松不算
export const JOTHON_GUESS = /黑客松|hackath\w*n|ai\s*monday|放輕松|跑咖松/i;
// 標題裡也有「黑客松」但不是揪松主辦的系列
const NOT_JOTHON = /國會松|韌性松/;
const AI_MONDAY = /ai\s*monday/i;
const AIMONDAY_URL = 'https://data.civictech.tw/v0/aimonday/events.json';

export async function loadAll(root) {
  const read = async (dir) => {
    const d = path.join(root, dir);
    let files = [];
    try { files = (await readdir(d)).filter((f) => f.endsWith('.json')); } catch {}
    return Promise.all(files.map(async (f) => [f.slice(0, -5), JSON.parse(await readFile(path.join(d, f), 'utf8'))]));
  };
  const events = (await read('events')).map(([, e]) => e);
  const overrides = Object.fromEntries(await read('overrides'));
  return { events, overrides };
}

export async function loadAiMonday() {
  try {
    const r = await fetch(AIMONDAY_URL, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).records;
  } catch (e) {
    // 讀不到就當成沒有：AI Monday 場次這次會變成「待管理員確認」，不會讓整個建置失敗
    console.warn(`讀不到 AI Monday 資料（${e.message}），這次不自動確認 AI Monday 場次`);
    return [];
  }
}

export function resolve(events, overrides, aimonday = []) {
  return events
    .map((e) => {
      const o = overrides[e.id] ?? {};
      const r = { ...e, ...(o.set ?? {}) };
      const am = AI_MONDAY.test(r.title) && r.date_start
        ? aimonday.find((a) => a.date === r.date_start && a.series_slug === 'ai-monday')
        : null;
      r.aimonday_id = am?.id ?? null;
      r.hidden = o.hidden === true;
      r.jothon = typeof o.jothon === 'boolean' ? o.jothon : !!am;
      r.jothon_source = typeof o.jothon === 'boolean' ? 'override' : am ? 'aimonday' : null;
      // 猜得到是揪松活動、但沒有人確認過：報給管理員
      r.jothon_pending = r.jothon_source == null && JOTHON_GUESS.test(r.title) && !NOT_JOTHON.test(r.title);
      return r;
    })
    .sort((a, b) => (a.date_start ?? a.month_section ?? '9999').localeCompare(b.date_start ?? b.month_section ?? '9999'));
}

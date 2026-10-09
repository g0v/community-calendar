// 一次性補資料：從網路檔案館（Wayback Machine）的共筆存檔，把每日同步開始（2026-10-09）以前的活動補進 events/。
//
// 共筆會被定期清掉，所以在同步開始之前就被刪掉的活動，只剩存檔裡還看得到。限制：
//   - 存檔不是每天都有，兩次存檔之間新增又被刪掉的活動補不回來
//   - 2025 年初的共筆格式不同（沒有年份），parse() 用存檔當天的年份補
//
// 規則：
//   - 比對方式跟每日同步一樣（sync.mjs 的 match）
//   - 已經在 events/ 的：只把 first_seen 往前改成最早出現在存檔的那天；內容不動（每日同步的比存檔新）
//   - 補進來的：in_source: false（現在已不在共筆上），archive 記錄最早與最晚出現在哪一份存檔。
//     removed_from_source＝最後一次出現之後的下一份存檔日期（「最晚這天已經不在了」）；之後沒有存檔就是 null。
//     活動日之前就不見的，網站會標「共筆已移除」：多半是改期或取消前的舊計畫，不一定真的辦過
//   - 同一場出現在好幾份存檔：以最晚那份的內容為準
//
// 用法：node scripts/backfill-wayback.mjs            抓存檔並寫入 events/
//       DRY_RUN=1 node scripts/backfill-wayback.mjs  只印出會補幾筆
//       CACHE_DIR=path …                             存檔下載到這裡，重跑不必再抓

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from './parse.mjs';
import { match, SOURCE_URL } from './sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVENTS_DIR = path.join(ROOT, 'events');
const SYNC_STARTED = '2026-10-09';
const CDX = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent('g0v.hackmd.io/@jothon/event')}&output=json&fl=timestamp,statuscode&filter=statuscode:200`;

async function main() {
  const snaps = (await cdx()).slice(1).map(([ts]) => ts).filter((ts) => toDate(ts) < SYNC_STARTED);
  console.log(`網路檔案館有 ${snaps.length} 份同步開始前的存檔`);

  const { readdir } = await import('node:fs/promises');
  const stored = await Promise.all((await readdir(EVENTS_DIR)).filter((f) => f.endsWith('.json'))
    .map(async (f) => JSON.parse(await readFile(path.join(EVENTS_DIR, f), 'utf8'))));
  const byId = new Map(stored.map((r) => [r.id, r]));
  const original = new Map(stored.map((r) => [r.id, JSON.stringify(r)]));
  let created = 0;
  const parsedDates = []; // 讀得到內文的存檔日期，依序
  const lastSeen = new Map(); // 補進來的 id → 最後出現在哪一份存檔

  for (const ts of snaps.sort()) {
    const md = await snapshot(ts);
    if (!md) { console.log(`${ts}：讀不到共筆內文，略過`); continue; }
    const date = toDate(ts);
    const url = `https://web.archive.org/web/${ts}/${SOURCE_URL}`;
    if (parsedDates.at(-1) !== date) parsedDates.push(date);
    const { events } = parse(md, { defaultYear: +ts.slice(0, 4) });
    const { results } = match(events, [...byId.values()]);
    let added = 0;
    for (const { p, rec } of results) {
      // 只補同步開始前就辦完的。日期還沒到、卻已經不在共筆上的，是被後來的版本取代的舊計畫（例如「g0v 黑客松 (80-100人)」後來改成正式名稱），
      // 補進來只會在近期活動裡多出重複的一筆。只知道月份或年份的「規劃中」也不補
      if (!p.date_start || (p.date_end ?? p.date_start) >= SYNC_STARTED) { if (rec && !rec.archive && date < rec.first_seen) rec.first_seen = date; continue; }
      if (rec && !rec.archive) {
        // 每日同步建的那筆：內容以同步為準，只把「第一次出現」往前推
        if (date < rec.first_seen) rec.first_seen = date;
        continue;
      }
      const { source_line, ...rest } = p;
      const next = {
        id: rec?.id ?? makeId(p),
        source: 'jothon-hackmd',
        source_url: SOURCE_URL,
        ...rest,
        first_seen: rec?.first_seen ?? date,
        in_source: false,
        removed_from_source: null,
        archive: { first: rec?.archive.first ?? url, last: url },
      };
      if (!rec) { created++; added++; }
      byId.set(next.id, next);
      lastSeen.set(next.id, date);
    }
    console.log(`${date}：解析 ${events.length} 筆，新補 ${added} 筆`);
  }

  for (const [id, seen] of lastSeen) {
    byId.get(id).removed_from_source = parsedDates.find((d) => d > seen) ?? null;
  }

  const changed = [...byId.values()].filter((r) => original.get(r.id) !== JSON.stringify(r));
  console.log(`共新補 ${created} 筆，${changed.length - created} 筆既有資料的 first_seen 往前改`);
  if (process.env.DRY_RUN) return;
  for (const r of changed) await writeFile(path.join(EVENTS_DIR, `${r.id}.json`), JSON.stringify(r, null, 2) + '\n');
}

// 存檔的原始 HTML（id_ 代表不要網路檔案館加料）。HackMD 的發布頁把 Markdown 原文放在 #doc 裡
async function snapshot(ts) {
  const dir = process.env.CACHE_DIR;
  const file = dir && path.join(dir, `${ts}.html`);
  let html = file ? await readFile(file, 'utf8').catch(() => null) : null;
  if (!html) {
    const r = await fetch(`https://web.archive.org/web/${ts}id_/${SOURCE_URL}`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return null;
    html = await r.text();
    if (file) { await mkdir(dir, { recursive: true }); await writeFile(file, html); }
  }
  const m = /<div id="doc"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  return m && m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// 網路檔案館常常暫時回一頁 HTML 錯誤，等一下再試
async function cdx() {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(CDX, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
    const text = r?.ok ? await r.text() : '';
    if (text.startsWith('[')) return JSON.parse(text);
    console.log(`網路檔案館索引讀取失敗（${r?.status ?? '連線錯誤'}），${10 * (i + 1)} 秒後重試`);
    await new Promise((ok) => setTimeout(ok, 10_000 * (i + 1)));
  }
  throw new Error('讀不到網路檔案館的存檔索引');
}

const toDate = (ts) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;

// 跟 sync.mjs 同一套 id 規則
function makeId(p) {
  const h = createHash('sha1').update(`jothon-hackmd|${p.title}|${p.date_start}`).digest('hex').slice(0, 6);
  return `${p.date_start}-${h}`;
}

await main();

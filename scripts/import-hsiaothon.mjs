// 從「小松果」清單（g0v.hackmd.io/@jothon/hsiaothon）補 2019 年起的小松。
//
// 小松果不是活動公告，是 g0v 台北社群空間的使用紀錄：揪松團把每一場用到空間的小聚編號（[No.53]），
// 附上成果共筆。所以：
//   - 只收有編號的（[No.N]）——沒編號的是場地備註（消毒、搬物資）、刪除線的是取消的
//   - 只收同步開始（2026-10-09）前的——之後的是場地預約，活動本身會出現在活動共筆上
//   - 已經在 events/ 的同一場（比對方式跟每日同步一樣）：不另開一筆，只在那筆加上 hsiaothon 欄位（編號與成果共筆）
//   - 對不上的：開新的一筆，source 是 hsiaothon
// 可以重複跑。
//
// 用法：node scripts/import-hsiaothon.mjs     DRY_RUN=1 只印出會補幾筆

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeOf } from './parse.mjs';
import { match } from './sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVENTS_DIR = path.join(ROOT, 'events');
const LIST_URL = 'https://g0v.hackmd.io/@jothon/hsiaothon';
const SYNC_STARTED = '2026-10-09';

const pad = (n) => String(n).padStart(2, '0');
const abs = (u) => (u.startsWith('/') ? `https://g0v.hackmd.io${u}` : u);

export function parseList(md) {
  const out = [];
  let year = null;
  for (const line of md.split(/\r?\n/)) {
    const y = /^(\d{4})\s*(小松果|松果)/.exec(line);
    if (y) { year = +y[1]; continue; }
    const m = /^-\s*\[No\.?\s*(\d+)\]\s*(.*)$/.exec(line.trim());
    if (!m || !year) continue;
    let text = m[2].replace(/🌲/g, '').trim();
    const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((x) => abs(x[1]));
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[target=_blank\]/g, '').trim();
    const d = /^(\d{2})(\d{2})\s*/.exec(text);
    if (!d) continue;
    let rest = text.slice(d[0].length);
    // 「(1400-1800) SITCON Podcast 錄音」：括號裡的是時段
    let hhmm = null;
    const pt = /^[(（](\d{2})(\d{2})\s*-\s*(\d{2})(\d{2})[)）]\s*/.exec(rest);
    if (pt) { hhmm = { start_time: `${pt[1]}:${pt[2]}`, end_time: `${pt[3]}:${pt[4]}` }; rest = rest.slice(pt[0].length); }
    // 「週日上午下午晚上」「週二晚上 20:00」這些只描述時段，不是名稱
    let title = rest.replace(/^(週[一二三四五六日]\s*)?((上午|下午|晚上|中午|傍晚|早上|與|及|、)+\s*)?(\d{1,2}[:：]\d{2}(\s*-\s*\d{1,2}[:：]\d{2})?\s*)?/, '').trim();
    const pt2 = /^[(（](\d{2})(\d{2})\s*-\s*(\d{2})(\d{2})[)）]\s*/.exec(title); // 星期後面才接括號時段
    if (pt2) { hhmm ??= { start_time: `${pt2[1]}:${pt2[2]}`, end_time: `${pt2[3]}:${pt2[4]}` }; title = title.slice(pt2[0].length); }
    out.push({
      no: +m[1],
      title: title || rest,
      date_start: `${year}-${d[1]}-${d[2]}`,
      ...(hhmm ?? timeOf(rest.slice(0, 30), rest)),
      links,
      line: line.trim(),
    });
  }
  return out;
}

async function main() {
  const md = await (await fetch(`${LIST_URL}/download`)).text();
  const list = parseList(md).filter((x) => x.date_start < SYNC_STARTED);
  console.log(`小松果有 ${list.length} 筆同步開始前、有編號的小松`);

  const files = (await readdir(EVENTS_DIR)).filter((f) => f.endsWith('.json'));
  const stored = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(EVENTS_DIR, f), 'utf8'))));
  const before = new Map(stored.map((r) => [r.id, JSON.stringify(r)]));

  // 給 match() 用的形狀：跟共筆解析出來的一樣有 title／date_start／各種網址
  const parsed = list.map((x) => ({ ...x, signup_url: null, page_url: null, notes_url: x.links[0] ?? null, month_section: x.date_start.slice(0, 7) }));
  const { results } = match(parsed, stored);
  const out = new Map(stored.map((r) => [r.id, r]));
  let attached = 0, created = 0;

  for (const { p, rec } of results) {
    const tag = { no: p.no, year: +p.date_start.slice(0, 4), notes_url: p.links[0] ?? null, line: p.line };
    if (rec && rec.source !== 'hsiaothon') {
      out.set(rec.id, { ...rec, hsiaothon: tag });
      attached++;
      continue;
    }
    const id = rec?.id ?? `${p.date_start}-${createHash('sha1').update(`hsiaothon|${p.no}|${p.date_start}`).digest('hex').slice(0, 6)}`;
    out.set(id, {
      id,
      source: 'hsiaothon',
      source_url: LIST_URL,
      title: p.title,
      date_start: p.date_start, date_end: null, date_precision: 'day',
      start_time: p.start_time, end_time: p.end_time,
      venue: null, address: null, signup_url: null, notes_url: p.links[0] ?? null, page_url: null, host: null,
      sub_sessions: [], fields: {}, links: p.links, description: [],
      month_section: p.date_start.slice(0, 7),
      raw: p.line, warnings: [],
      first_seen: null, in_source: false, removed_from_source: null,
      hsiaothon: tag,
    });
    if (!rec) created++;
  }

  const changed = [...out.values()].filter((r) => before.get(r.id) !== JSON.stringify(r));
  console.log(`新增 ${created} 筆，${attached} 筆既有活動對上（加上小松果編號與成果共筆）；實際變動 ${changed.length} 個檔案`);
  if (process.env.DRY_RUN) return;
  for (const r of changed) await writeFile(path.join(EVENTS_DIR, `${r.id}.json`), JSON.stringify(r, null, 2) + '\n');
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) await main();

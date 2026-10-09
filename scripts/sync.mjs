// 每日同步：讀共筆 → 解析 → 併進 events/（累積保存）→ 寫 report.json。
//
// 跟一般同步最大的不同：**共筆是會被定期清掉的**（過期的活動會被刪），所以這裡不能「共筆長怎樣、資料就長怎樣」。
//   - 共筆上還在的：有改就更新那一筆
//   - 共筆上不見的：留著，標 in_source: false 與消失的日期
//   - 一筆都不刪。要下架請用 overrides/{id}.json 的 hidden（見 README）
//
// 一場活動一個檔案，所以 GitHub 上 events/{id}.json 的 History 就是那場活動的修改紀錄。
// 為了讓那份 History 只記「真的有改」的時候，檔案裡刻意不放每天都會變的欄位（例如 last_seen）。
//
// 用法：
//   node scripts/sync.mjs                    讀線上共筆
//   SOURCE_FILE=path/to/event.md node scripts/sync.mjs   讀本機檔案（測試用）
//   TODAY=2026-10-09 …                       指定「今天」（測試用）

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from './parse.mjs';
import { loadAll, loadAiMonday, resolve } from './resolve.mjs';

export const SOURCE_URL = 'https://g0v.hackmd.io/@jothon/event';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVENTS_DIR = path.join(ROOT, 'events');
const SOURCE = 'jothon-hackmd';
const TODAY = process.env.TODAY ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

// 解析到的筆數比目前在共筆上的少太多，多半是共筆被整份改版或清空，不是活動真的都取消了。
// 這時候停下來，不要把所有活動一口氣標成「已從共筆移除」
const MIN_RATIO = 0.3;

async function main() {
  const report = { generated_at: new Date().toISOString(), today: TODAY, source: SOURCE_URL, counts: {}, errors: [], warnings: [] };
  let md;
  try {
    md = process.env.SOURCE_FILE ? await readFile(process.env.SOURCE_FILE, 'utf8') : await fetchSource();
  } catch (e) {
    // 讀不到共筆也要留下報告，資料檢查 issue 才會開出來；不然只會在 Actions 裡安靜地紅一格
    report.errors.push({ where: '共筆', msg: `讀不到共筆：${e.message}。這次不更新資料` });
    await writeReport(report);
    console.error(report.errors[0].msg);
    process.exitCode = 1;
    return;
  }
  const { events: parsed, warnings: parseWarnings } = parse(md);
  const stored = await loadStored();

  const alive = stored.filter((r) => r.in_source).length;
  if (parsed.length === 0 || (alive >= 5 && parsed.length < alive * MIN_RATIO)) {
    report.errors.push({ where: '共筆', msg: `只解析到 ${parsed.length} 筆活動（目前共筆上應有 ${alive} 筆）。共筆可能被整份改版或清空，這次不更新資料，請人看一下` });
    await writeReport(report);
    console.error(report.errors[0].msg);
    process.exitCode = 1;
    return;
  }

  const { results, unmatched } = match(parsed, stored);
  let created = 0, updated = 0, removed = 0, restored = 0;

  for (const { p, rec, how } of results) {
    const next = toRecord(p, rec);
    if (!rec) created++;
    else {
      if (!rec.in_source) restored++;
      if (how === 'title' && rec.date_start !== p.date_start) {
        report.warnings.push({ where: `共筆第 ${p.source_line} 行`, id: next.id, msg: `「${next.title}」的日期從 ${rec.date_start ?? '未定'} 改成 ${p.date_start ?? '未定'}，已當成同一場更新。如果其實是兩場不同的活動，請開 issue 告訴管理員` });
      }
    }
    if (await save(next, rec)) { if (rec) updated++; }
  }

  for (const rec of unmatched) {
    if (!rec.in_source) continue;
    removed++;
    await save({ ...rec, in_source: false, removed_from_source: TODAY }, rec);
  }

  // 新開的一筆，跟「今天剛從共筆消失」的某筆同一天：多半是同一場被改了標題，提醒人看一下
  const goneToday = unmatched.filter((r) => r.in_source);
  for (const { p, rec } of results) {
    if (rec || !p.date_start) continue;
    const twin = goneToday.find((g) => g.date_start === p.date_start);
    if (twin) report.warnings.push({ where: `共筆第 ${p.source_line} 行`, msg: `「${p.title}」可能跟已從共筆消失的「${twin.title}」（${twin.id}）是同一場。如果是，請在 overrides/${twin.id}.json 標 hidden，或告訴維護者合併` });
  }

  for (const w of parseWarnings) report.warnings.push({ where: `共筆第 ${w.line} 行`, msg: w.msg });

  // 標題看起來是揪松主辦、但還沒有管理員確認的（只報還沒辦的，過去的不吵）
  const { events: all, overrides } = await loadAll(ROOT);
  for (const e of resolve(all, overrides, await loadAiMonday())) {
    if (!e.jothon_pending || e.hidden || (e.date_start && (e.date_end ?? e.date_start) < TODAY)) continue;
    report.warnings.push({ where: e.id, id: e.id, msg: `「${e.title}」看起來是揪松主辦。是的話請建立 overrides/${e.id}.json 寫 {"jothon": true}，才會進揪松日曆；不是就寫 {"jothon": false}` });
  }
  report.counts = { parsed: parsed.length, created, updated, removed, restored, total: stored.length + created };
  await writeReport(report);
  console.log(`共筆 ${parsed.length} 筆：新增 ${created}、更新 ${updated}、從共筆消失 ${removed}、重新出現 ${restored}；警告 ${report.warnings.length}`);
}

// ---------- 比對：共筆上這一筆，是不是資料裡已經有的那一筆 ----------
//
// 共筆誰都能改，標題、日期都可能被改，所以按可信度依序試：
//   1. 連結：報名／共筆／活動頁的網址，且這個網址在共筆上只出現在這一筆（同一張報名表被好幾場共用是常態）
//   2. 同一天＋標題相似
//   3. 標題一字不差、日期不同（改期）→ 同一場，但報一條警告
// 都對不上就是新的一筆。寧可多一筆讓人合併，也不要把兩場不同的活動默默合成一筆。

export function match(parsed, stored) {
  const pool = new Set(stored);
  const count = new Map();
  for (const p of parsed) for (const u of keyLinks(p)) count.set(u, (count.get(u) ?? 0) + 1);

  const results = parsed.map((p) => ({ p, rec: null, how: null }));
  const claim = (r, rec, how) => { r.rec = rec; r.how = how; pool.delete(rec); };

  for (const r of results) {
    const links = keyLinks(r.p).filter((u) => count.get(u) === 1);
    const hits = [...pool].filter((rec) => keyLinks(rec).some((u) => links.includes(u)));
    if (hits.length === 1) claim(r, hits[0], 'link');
  }
  for (const r of results) {
    if (r.rec) continue;
    const best = [...pool]
      .filter((rec) => sameWhen(rec, r.p))
      .map((rec) => [rec, similarity(rec.title, r.p.title)])
      .filter(([, s]) => s >= 0.5)
      .sort((a, b) => b[1] - a[1])[0];
    if (best) claim(r, best[0], 'date+title');
  }
  for (const r of results) {
    if (r.rec) continue;
    const same = [...pool].filter((rec) => norm(rec.title) === norm(r.p.title));
    if (same.length === 1) claim(r, same[0], 'title');
  }
  return { results, unmatched: [...pool] };
}

const keyLinks = (e) => [e.signup_url, e.notes_url, e.page_url].filter(Boolean);
const sameWhen = (a, b) => a.date_start === b.date_start && (a.date_start || a.month_section === b.month_section);

// 去掉空白、標點、星期、emoji 之後比對
export const norm = (s) => s.toLowerCase().replace(/週[一二三四五六日]|[上下中晚早]午|晚上/g, '').replace(/[^\p{L}\p{N}]/gu, '');

// 兩個字一組的 Dice 係數，中文英文都能用
export function similarity(a, b) {
  const grams = (s) => { const n = norm(s); const g = []; for (let i = 0; i < n.length - 1; i++) g.push(n.slice(i, i + 2)); return g.length ? g : [n]; };
  const A = grams(a), B = grams(b);
  const pool = [...B];
  let hit = 0;
  for (const g of A) { const k = pool.indexOf(g); if (k >= 0) { hit++; pool.splice(k, 1); } }
  return (2 * hit) / (A.length + B.length);
}

// ---------- 檔案 ----------

function toRecord(p, prev) {
  const id = prev?.id ?? makeId(p);
  const { source_line, warnings, ...rest } = p;
  return {
    id,
    source: SOURCE,
    source_url: SOURCE_URL,
    ...rest,
    warnings,
    first_seen: prev?.first_seen ?? TODAY,
    in_source: true,
    removed_from_source: null,
  };
}

// id 在第一次看到時決定，之後永遠不變（就算標題、日期被改）：網址與訂閱日曆的 UID 都靠它
function makeId(p) {
  const when = p.date_start ?? p.month_section ?? 'undated';
  const h = createHash('sha1').update(`${SOURCE}|${p.title}|${p.date_start}`).digest('hex').slice(0, 6);
  return `${when}-${h}`;
}

async function loadStored() {
  await mkdir(EVENTS_DIR, { recursive: true });
  const files = (await readdir(EVENTS_DIR)).filter((f) => f.endsWith('.json'));
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(EVENTS_DIR, f), 'utf8'))));
}

// 內容沒變就不寫，免得 git 每天記一筆沒意義的修改
async function save(rec, prev) {
  if (prev && JSON.stringify(prev) === JSON.stringify(rec)) return false;
  await writeFile(path.join(EVENTS_DIR, `${rec.id}.json`), JSON.stringify(rec, null, 2) + '\n');
  return true;
}

async function writeReport(report) {
  await writeFile(path.join(ROOT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}

// 共筆的 Markdown 原文
async function fetchSource() {
  const url = `${SOURCE_URL}/download`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'g0v-community-calendar (+https://github.com/g0v/community-calendar)' } });
  console.log(`${url} → HTTP ${r.status}`);
  if (!r.ok) throw new Error(`${url} 回 HTTP ${r.status}`);
  return r.text();
}

// 路徑有中文時 import.meta.url 會被百分比編碼，所以比對前先轉回檔案路徑
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) await main();

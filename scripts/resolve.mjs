// 把 events/（從共筆累積來的原始資料）套上 overrides/（管理員的修正），得到網站與日曆實際用的資料。
//
// 共筆誰都能編，所以兩件事**不讀共筆**，只讀 overrides：
//   - 下架：overrides/{id}.json 的 "hidden": true
//   - 揪松主辦：overrides/{id}.json 的 "jothon": true（共筆上寫「主辦：揪松」不算數）
// 唯一的例外是 AI Monday：揪松團自己維護的 AI Monday 資料（data.civictech.tw）同一天也有一場，
// 就當成已確認，不必每個月請管理員蓋一次章。
//
// AI Monday 那張 Sheet 也是第二個資料來源：只在 Sheet 上的場次（共筆清掉的、沒寫上共筆的）
// 在建置時直接加進來，不存進 events/——它們的修改紀錄在 civictech-tw-data，不在這裡。
// 要修正或下架，overrides 的檔名用 aimonday-{AI Monday 的場次 id}.json
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
import { facets } from './facets.mjs';

// 揪松主辦的系列（2026-10-09 定）：大松、AI Monday、放輕松、跑咖松。國會松與小松不算
export const JOTHON_GUESS = /黑客松|hackath\w*n|ai\s*monday|放輕松|跑咖松/i;
// 標題裡也有「黑客松」但不是揪松主辦的系列
const NOT_JOTHON = /國會松|韌性松|小黑客松|hack進/;
const AI_MONDAY = /ai\s*monday/i;
const AIMONDAY_API = 'https://data.civictech.tw/v0/aimonday';
const AIMONDAY_SITE = 'https://g0v.github.io/AI-Monday';

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

// AI Monday 工作小組維護的資料（data.civictech.tw）。讀不到就當成沒有：AI Monday 場次這次只會有共筆上的那些，
// 而且不會自動算揪松主辦，但不會讓整個建置失敗
export async function loadAiMonday() {
  try {
    const get = async (t) => {
      const r = await fetch(`${AIMONDAY_API}/${t}.json`, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`${t}.json：HTTP ${r.status}`);
      return (await r.json()).records;
    };
    const [events, talks] = await Promise.all([get('events'), get('talks')]);
    return { events, talks };
  } catch (e) {
    console.warn(`讀不到 AI Monday 資料（${e.message}），這次只用共筆上的 AI Monday 場次`);
    return { events: [], talks: [] };
  }
}

// AI Monday 那張 Sheet 收的系列，與共筆標題的對應。用「同一天＋同系列」認出共筆上已經有的那一場
const AM_SERIES = { 'ai-monday': /ai\s*monday/i, congressthon: /國會松|congressthon/i, coscup: /coscup/i };

export function resolve(events, overrides, aimonday = { events: [], talks: [] }) {
  const amEvents = Array.isArray(aimonday) ? aimonday : aimonday.events; // 相容舊的呼叫方式
  const amTalks = Array.isArray(aimonday) ? [] : aimonday.talks;
  const claimed = new Set();

  const fromHackmd = events.map((e) => {
    const o = overrides[e.id] ?? {};
    const r = { ...e, ...(o.set ?? {}) };
    const am = r.date_start
      ? amEvents.find((a) => a.date === r.date_start && AM_SERIES[a.series_slug]?.test(r.title) && !claimed.has(a.id))
      : null;
    if (am) {
      claimed.add(am.id);
      // 同一場：時間與講者以 AI Monday 的 Sheet 為準（工作小組維護、比共筆完整）
      if (am.start_time) Object.assign(r, { start_time: am.start_time, end_time: am.end_time ?? r.end_time });
      r.talks = talksOf(am, amTalks);
    }
    r.aimonday_id = am?.id ?? null;
    r.aimonday_url = am ? `${AIMONDAY_SITE}/events/${am.id}/` : null;
    r.cancelled = am?.status === '停辦';
    r.hidden = o.hidden === true;
    r.has_override = e.id in overrides;
    const amJothon = am?.series_slug === 'ai-monday';
    r.jothon = typeof o.jothon === 'boolean' ? o.jothon : amJothon;
    r.jothon_source = typeof o.jothon === 'boolean' ? 'override' : amJothon ? 'aimonday' : null;
    // 猜得到是揪松活動、但沒有人確認過：報給管理員
    r.jothon_pending = r.jothon_source == null && JOTHON_GUESS.test(r.title) && !NOT_JOTHON.test(r.title);
    return r;
  });

  // 只在 AI Monday Sheet 上、共筆上沒有的場次（共筆清掉的、或從來沒寫上共筆的）
  const fromAiMonday = amEvents.filter((a) => !claimed.has(a.id)).map((a) => fromAm(a, amTalks, overrides[`aimonday-${a.id}`]));

  return [...fromHackmd, ...fromAiMonday]
    .map((r) => ({ ...r, ...facets(r) }))
    .sort((a, b) => (a.date_start ?? a.month_section ?? '9999').localeCompare(b.date_start ?? b.month_section ?? '9999'));
}

const talksOf = (am, talks) =>
  talks.filter((t) => t.event_id === am.id && !t.open_slot && t.kind === 'talk')
    .sort((a, b) => a.order - b.order)
    .map((t) => ({ title: t.title, speakers: t.speakers.map((s) => s.name), url: `${AIMONDAY_SITE}/talks/${t.id}/` }));

function fromAm(a, talks, found) {
  const o = found ?? {};
  const title = a.theme ? `${a.series}｜${a.theme}` : a.series;
  const r = {
    id: `aimonday-${a.id}`,
    source: 'aimonday',
    source_url: `${AIMONDAY_SITE}/events/${a.id}/`,
    title,
    date_start: a.date, date_end: null, date_precision: 'day',
    start_time: a.start_time, end_time: a.end_time ?? null,
    venue: a.venue ?? a.format, address: null, host: a.series_slug === 'ai-monday' ? 'AI Monday 工作小組' : null,
    signup_url: null, notes_url: a.notes_url, page_url: null,
    sub_sessions: [], fields: {}, links: [], description: [], month_section: a.date.slice(0, 7),
    raw: '', warnings: [], first_seen: null, in_source: true, removed_from_source: null,
    status: a.status,
    ...(o.set ?? {}),
  };
  const jothon = typeof o.jothon === 'boolean' ? o.jothon : a.series_slug === 'ai-monday';
  return {
    ...r,
    talks: talksOf(a, talks),
    aimonday_id: a.id, aimonday_url: r.source_url,
    cancelled: a.status === '停辦',
    hidden: o.hidden === true,
    has_override: !!found,
    jothon, jothon_source: 'aimonday', jothon_pending: false,
  };
}

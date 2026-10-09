// 把「修改活動」「新增活動」的 issue（.github/ISSUE_TEMPLATE/ 的表單）轉成檔案變更，交給 workflow 開 PR。
//
//   修改活動 → overrides/{活動代號}.json：把有填的欄位寫進 set，「請拿掉」寫成 hidden，理由記在 note
//   新增活動 → manual/{日期}-i{issue 編號}.json：一筆新的活動
//
// issue 內容是任何人都能寫的，所以這裡只做白名單：
//   - 只認得表單上有的欄位，其他一律忽略
//   - 日期、時間、網址要符合格式，不然整張 issue 回報錯誤、不開 PR
//   - 寫入的路徑只會是 overrides/ 或 manual/ 底下，檔名由驗證過的代號或日期組成
//
// 用法（workflow 裡）：node scripts/issue-to-pr.mjs "$GITHUB_EVENT_PATH"
// 結果寫到 issue-result.json：{ ok, kind, files, title, body } 或 { ok: false, errors }

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import seriesConfig from '../config/series.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 表單上的標題 → 欄位。兩份表單共用
const LABELS = {
  '活動代號': 'event_id', '活動名稱': 'name',
  '日期': 'date', '結束日期（跨天才填）': 'date_end', '開始時間': 'start_time', '結束時間': 'end_time',
  '地點': 'venue', '地址': 'address', '主辦': 'host',
  '報名網址': 'signup_url', '線上參加網址': 'online_url', '共筆網址': 'notes_url', '活動頁': 'page_url',
  '要不要從行事曆上拿掉？': 'takedown', '系列': 'series', '揪松主辦': 'jothon', '為什麼要改': 'reason', '活動說明': 'description', '你跟這場活動的關係': 'reason',
};
// 表單欄位 → 活動資料的欄位
const TO_EVENT = {
  name: 'title', date: 'date_start', date_end: 'date_end', start_time: 'start_time', end_time: 'end_time',
  venue: 'venue', address: 'address', host: 'host',
  signup_url: 'signup_url', online_url: 'online_url', notes_url: 'notes_url', page_url: 'page_url',
};

export function parseIssueBody(body) {
  const out = {};
  for (const part of `\n${body ?? ''}`.split(/\n### /).slice(1)) {
    const nl = part.indexOf('\n');
    const label = part.slice(0, nl).trim();
    const value = part.slice(nl + 1).trim();
    const key = LABELS[label];
    if (key && value && value !== '_No response_') out[key] = value;
  }
  return out;
}

function validate(f, errors) {
  const v = {};
  const one = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 300);
  for (const [k, raw] of Object.entries(f)) {
    const s = raw.trim();
    if (k === 'date' || k === 'date_end') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) errors.push(`「${k === 'date' ? '日期' : '結束日期'}」要寫成 YYYY-MM-DD，現在是「${s}」`);
      else v[k] = s;
    } else if (k === 'start_time' || k === 'end_time') {
      const m = /^(\d{1,2})[:：](\d{2})$/.exec(s);
      if (!m || +m[1] > 23 || +m[2] > 59) errors.push(`時間要寫成 HH:MM，現在是「${s}」`);
      else v[k] = `${m[1].padStart(2, '0')}:${m[2]}`;
    } else if (k.endsWith('_url')) {
      if (!/^https?:\/\/\S+$/.test(s)) errors.push(`網址要以 http:// 或 https:// 開頭，現在是「${s}」`);
      else v[k] = s.slice(0, 500);
    } else if (k === 'event_id') {
      if (!/^[a-z0-9-]{6,80}$/.test(s)) errors.push(`活動代號的格式不對：「${s}」`);
      else v[k] = s;
    } else if (k === 'series') {
      // 網站上的下拉選單送來的是 slug；手動填的也接受系列名稱。「none」＝不屬於任何系列
      const hit = seriesConfig.series.find((x) => x.slug === s || x.name === s);
      if (s === 'none' || s === '無') v[k] = null;
      else if (hit) v[k] = hit.slug;
      else errors.push(`沒有「${s}」這個系列，可以用的有：${seriesConfig.series.map((x) => x.slug).join('、')}`);
    } else if (k === 'jothon') {
      if (/^(是|yes|true)$/i.test(s)) v[k] = true;
      else if (/^(不是|否|no|false)$/i.test(s)) v[k] = false;
      else errors.push(`「揪松主辦」請寫「是」或「不是」，現在是「${s}」`);
    } else if (k === 'description' || k === 'reason') {
      v[k] = s.slice(0, 2000);
    } else {
      v[k] = one(s);
    }
  }
  return v;
}

export async function handle(issue) {
  const labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
  const kind = labels.includes('修改活動') ? 'edit' : labels.includes('新增活動') ? 'new' : null;
  if (!kind) return { ok: false, errors: ['這張 issue 沒有「修改活動」或「新增活動」標籤'] };
  const errors = [];
  const f = validate(parseIssueBody(issue.body), errors);
  const ref = `#${issue.number}`;

  if (kind === 'edit') {
    if (!f.event_id) errors.push('缺少「活動代號」');
    const isAm = f.event_id?.startsWith('aimonday-');
    if (f.event_id && !isAm && !existsSync(path.join(ROOT, 'events', `${f.event_id}.json`)) && !existsSync(path.join(ROOT, 'manual', `${f.event_id}.json`))) {
      errors.push(`找不到活動代號「${f.event_id}」，請從活動頁的「修改這筆」進來`);
    }
    const set = Object.fromEntries(Object.entries(TO_EVENT).filter(([k]) => f[k]).map(([k, to]) => [to, f[k]]));
    // 用文字欄位而不是下拉選單：GitHub 的 issue 表單只有文字欄位能從網址預先填好
    const takedown = /拿掉|下架|移除/.test(f.takedown ?? '');
    const series = 'series' in f ? { series: f.series } : null;
    const jothon = 'jothon' in f ? { jothon: f.jothon } : null;
    if (!Object.keys(set).length && !takedown && !series && !jothon) errors.push('沒有填任何要改的欄位，也沒有選擇拿掉');
    if (errors.length) return { ok: false, kind, errors };

    // manual/ 的活動直接改那個檔案；其他的寫進 overrides/
    if (existsSync(path.join(ROOT, 'manual', `${f.event_id}.json`))) {
      const file = `manual/${f.event_id}.json`;
      const cur = JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
      const next = { ...cur, ...set, ...(series ? { series_fixed: series.series } : {}), ...(jothon ? { jothon_fixed: jothon.jothon } : {}), ...(takedown ? { hidden: true } : {}) };
      return done(kind, issue, [[file, next]], { ...set, ...(series ?? {}), ...(jothon ?? {}) }, takedown, f.reason, f.event_id);
    }
    const file = `overrides/${f.event_id}.json`;
    const cur = existsSync(path.join(ROOT, file)) ? JSON.parse(await readFile(path.join(ROOT, file), 'utf8')) : {};
    const next = {
      ...cur,
      ...(takedown ? { hidden: true } : {}),
      ...(Object.keys(set).length ? { set: { ...(cur.set ?? {}), ...set } } : {}),
      ...(series ?? {}),
      ...(jothon ?? {}),
      note: [cur.note, `${ref}：${(f.reason ?? '').replace(/\s+/g, ' ').slice(0, 200)}`].filter(Boolean).join('／'),
    };
    return done(kind, issue, [[file, next]], { ...set, ...(series ?? {}), ...(jothon ?? {}) }, takedown, f.reason, f.event_id);
  }

  // 新增活動
  if (!f.name) errors.push('缺少「活動名稱」');
  if (!f.date) errors.push('缺少「日期」');
  if (errors.length) return { ok: false, kind, errors };
  const id = `${f.date}-i${issue.number}`;
  const ev = {
    id,
    source: 'manual',
    source_url: issue.html_url,
    title: f.name,
    date_start: f.date, date_end: f.date_end ?? null, date_precision: 'day',
    start_time: f.start_time ?? null, end_time: f.end_time ?? null,
    venue: f.venue ?? null, address: f.address ?? null, host: f.host ?? null,
    signup_url: f.signup_url ?? null, online_url: f.online_url ?? null, notes_url: f.notes_url ?? null, page_url: f.page_url ?? null,
    sub_sessions: [], fields: {}, links: [], description: f.description ? f.description.split(/\n+/) : [],
    month_section: f.date.slice(0, 7),
    raw: '', warnings: [],
    first_seen: issue.created_at?.slice(0, 10) ?? null, in_source: false, removed_from_source: null,
    ...('series' in f ? { series_fixed: f.series } : {}),
    ...('jothon' in f ? { jothon_fixed: f.jothon } : {}),
  };
  return done(kind, issue, [[`manual/${id}.json`, ev]], null, false, f.reason, id);
}

// ---------- PR 內文：給管理員判斷要不要合併 ----------
//
// 管理員要知道的：這是哪一場（連到網站）、每個欄位從什麼改成什麼、誰送的、
// 這場還在不在共筆上（在的話改共筆比較好）、新增的同一天有沒有已經有的、有沒有看起來不對的地方

const SITE = 'https://g0v.github.io/community-calendar';
const FIELD_NAME = {
  title: '活動名稱', date_start: '日期', date_end: '結束日期', start_time: '開始時間', end_time: '結束時間',
  venue: '地點', address: '地址', host: '主辦', signup_url: '報名網址', online_url: '線上參加網址',
  notes_url: '共筆網址', page_url: '活動頁', series: '系列', jothon: '揪松主辦',
};
const SERIES_NAME = Object.fromEntries(seriesConfig.series.map((x) => [x.slug, x.name]));
const show = (k, v) => {
  if (v === undefined || v === null || v === '') return '（空）';
  if (k === 'jothon') return v ? '是' : '不是';
  if (k === 'series') return SERIES_NAME[v] ?? v;
  return String(v).replace(/\|/g, '\\|');
};
const readJson = async (rel) => (existsSync(path.join(ROOT, rel)) ? JSON.parse(await readFile(path.join(ROOT, rel), 'utf8')) : null);

// 這場活動「現在」在網站上的值：原始資料＋已經有的修正
async function current(id) {
  const base = (await readJson(`events/${id}.json`)) ?? (await readJson(`manual/${id}.json`));
  const o = (await readJson(`overrides/${id}.json`)) ?? {};
  if (!base) return null;
  const r = { ...base, ...(o.set ?? {}) };
  const { seriesOf } = await import('./facets.mjs');
  r.series = 'series' in o ? o.series : base.series_fixed !== undefined ? base.series_fixed : seriesOf(r.title)?.slug ?? null;
  r.jothon = typeof o.jothon === 'boolean' ? o.jothon : typeof base.jothon_fixed === 'boolean' ? base.jothon_fixed : undefined;
  r.hidden = o.hidden === true || base.hidden === true;
  return r;
}

async function author(issue) {
  const login = issue.user?.login;
  const relation = {
    OWNER: '擁有者', MEMBER: 'g0v 組織成員', COLLABORATOR: '協作者', CONTRIBUTOR: '貢獻過這個 repo',
    FIRST_TIME_CONTRIBUTOR: '第一次貢獻', FIRST_TIMER: '第一次在 GitHub 上貢獻', NONE: '第一次來',
  }[issue.author_association] ?? issue.author_association;
  let age = '';
  try {
    const r = await fetch(`https://api.github.com/users/${login}`, { headers: process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {} });
    const u = await r.json();
    if (u.created_at) {
      const days = Math.floor((Date.now() - Date.parse(u.created_at)) / 864e5);
      age = days < 30 ? `，**帳號建立才 ${days} 天**` : `，帳號建立於 ${u.created_at.slice(0, 10)}`;
    }
  } catch {}
  return `@${login}（${relation}${age}）`;
}

function sanity(r) {
  const w = [];
  if (r.start_time && r.end_time && r.end_time <= r.start_time) w.push(`結束時間（${r.end_time}）沒有晚於開始時間（${r.start_time}）`);
  if (r.date_end && r.date_start && r.date_end < r.date_start) w.push(`結束日期（${r.date_end}）比開始日期（${r.date_start}）早`);
  return w;
}

async function done(kind, issue, files, changes, takedown, reason, id) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`由 #${issue.number} 自動產生，送出的人：${await author(issue)}`, ''];
  const warn = [];

  if (kind === 'edit') {
    const cur = await current(id);
    lines.push(`**活動**：[${cur?.title ?? id}](${SITE}/events/${id}/)（\`${id}\`）`);
    if (cur?.date_start) lines.push(`**日期**：${cur.date_start}${cur.date_end ? ` ～ ${cur.date_end}` : ''}`);
    lines.push('');
    if (takedown) {
      lines.push('### ⚠️ 要求從行事曆上拿掉', '', '合併後這場活動會從網站與所有訂閱日曆消失（資料仍保留，`hidden` 改回 false 就恢復）。', '');
    }
    // 值跟現在一樣的欄位不列，表格裡只留真的有變的
    const keys = Object.keys(changes ?? {}).filter((k) => !cur || show(k, cur[k]) !== show(k, changes[k]));
    if (keys.length) {
      lines.push('| 欄位 | 現在 | 改成 |', '|---|---|---|');
      for (const k of keys) {
        const from = k === 'title' ? cur?.title : cur?.[k];
        lines.push(`| ${FIELD_NAME[k] ?? k} | ${cur ? show(k, from) : '（AI Monday 的資料，這裡看不到原值）'} | **${show(k, changes[k])}** |`);
      }
      lines.push('');
    }
    if (cur?.in_source) warn.push('這場活動**還在揪松團的活動共筆上**。合併後，這裡的修正會一直蓋過共筆上的值——之後共筆改對了，網站也不會跟著變。能的話請改共筆，這個 PR 可以不合併。');
    if (cur?.hidden && !takedown) warn.push('這場活動目前是**下架**狀態，改了也不會顯示。');
    if (cur) warn.push(...sanity({ ...cur, ...changes }));
    if (id.startsWith('aimonday-')) warn.push('這場的原始資料來自 AI Monday 工作小組的 Sheet，這裡的修正只影響社群行事曆。');
  } else {
    const ev = files[0][1];
    lines.push(`**新增**：${ev.title}`, '', '| 欄位 | 內容 |', '|---|---|');
    for (const k of ['date_start', 'date_end', 'start_time', 'end_time', 'venue', 'address', 'host', 'signup_url', 'online_url', 'notes_url', 'page_url']) {
      if (ev[k]) lines.push(`| ${FIELD_NAME[k]} | ${show(k, ev[k])} |`);
    }
    if (ev.series_fixed !== undefined) lines.push(`| 系列 | ${show('series', ev.series_fixed)} |`);
    if (ev.jothon_fixed !== undefined) lines.push(`| 揪松主辦 | ${show('jothon', ev.jothon_fixed)} |`);
    if (ev.description?.length) lines.push(`| 說明 | ${ev.description.join(' ').replace(/\|/g, '\\|').slice(0, 300)} |`);
    lines.push('');
    // 同一天已經有的活動：最常見的問題是重複送
    const { readdir } = await import('node:fs/promises');
    const same = [];
    for (const dir of ['events', 'manual']) {
      if (!existsSync(path.join(ROOT, dir))) continue;
      for (const f of await readdir(path.join(ROOT, dir))) {
        const r = await readJson(`${dir}/${f}`);
        if (r?.date_start === ev.date_start && r.id !== ev.id) same.push(r);
      }
    }
    if (same.length) {
      lines.push(`**同一天已經有的活動**（${same.length} 場，看看是不是重複）：`, ...same.map((r) => `- [${r.title}](${SITE}/events/${r.id}/)`), '');
    } else {
      lines.push('同一天沒有其他活動。', '');
    }
    if (ev.date_start < today) warn.push(`日期（${ev.date_start}）已經過了。補登過去的活動沒問題，只是確認一下不是打錯年份。`);
    warn.push(...sanity(ev));
  }

  if (warn.length) lines.push('### 合併前請注意', '', ...warn.map((w) => `- ${w}`), '');
  lines.push(`**理由**：${(reason ?? '').replace(/\n+/g, ' ').slice(0, 1000)}`, '', '---', '合併後網站與訂閱日曆幾分鐘內更新。不採用的話直接關掉這個 PR，issue 會留著，方便回覆送出的人。', '', `Closes #${issue.number}`);

  return {
    ok: true, kind, files,
    title: `${kind === 'edit' ? '修改' : '新增'}：${issue.title.replace(/^(修改|新增)[:：]\s*/, '')}`.slice(0, 120),
    body: lines.join('\n'),
  };
}

async function main() {
  const event = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const result = await handle(event.issue);
  if (result.ok) {
    for (const [file, data] of result.files) {
      await mkdir(path.join(ROOT, path.dirname(file)), { recursive: true });
      await writeFile(path.join(ROOT, file), JSON.stringify(data, null, 2) + '\n');
    }
    result.files = result.files.map(([f]) => f);
  }
  await writeFile(path.join(ROOT, 'issue-result.json'), JSON.stringify(result, null, 2));
  console.log(result.ok ? `OK：${result.files.join(', ')}` : `不開 PR：${result.errors.join('；')}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) await main();

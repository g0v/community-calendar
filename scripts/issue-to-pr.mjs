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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 表單上的標題 → 欄位。兩份表單共用
const LABELS = {
  '活動代號': 'event_id', '活動名稱': 'name',
  '日期': 'date', '結束日期（跨天才填）': 'date_end', '開始時間': 'start_time', '結束時間': 'end_time',
  '地點': 'venue', '地址': 'address', '主辦': 'host',
  '報名網址': 'signup_url', '線上參加網址': 'online_url', '共筆網址': 'notes_url', '活動頁': 'page_url',
  '要不要從行事曆上拿掉？': 'takedown', '為什麼要改': 'reason', '活動說明': 'description', '你跟這場活動的關係': 'reason',
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
      errors.push(`找不到活動代號「${f.event_id}」，請從活動頁的「編輯這筆」進來`);
    }
    const set = Object.fromEntries(Object.entries(TO_EVENT).filter(([k]) => f[k]).map(([k, to]) => [to, f[k]]));
    // 用文字欄位而不是下拉選單：GitHub 的 issue 表單只有文字欄位能從網址預先填好
    const takedown = /拿掉|下架|移除/.test(f.takedown ?? '');
    if (!Object.keys(set).length && !takedown) errors.push('沒有填任何要改的欄位，也沒有選擇拿掉');
    if (errors.length) return { ok: false, kind, errors };

    // manual/ 的活動直接改那個檔案；其他的寫進 overrides/
    if (existsSync(path.join(ROOT, 'manual', `${f.event_id}.json`))) {
      const file = `manual/${f.event_id}.json`;
      const cur = JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
      const next = { ...cur, ...set, ...(takedown ? { hidden: true } : {}) };
      return done(kind, issue, [[file, next]], set, takedown, f.reason);
    }
    const file = `overrides/${f.event_id}.json`;
    const cur = existsSync(path.join(ROOT, file)) ? JSON.parse(await readFile(path.join(ROOT, file), 'utf8')) : {};
    const next = {
      ...cur,
      ...(takedown ? { hidden: true } : {}),
      ...(Object.keys(set).length ? { set: { ...(cur.set ?? {}), ...set } } : {}),
      note: [cur.note, `${ref}：${(f.reason ?? '').replace(/\s+/g, ' ').slice(0, 200)}`].filter(Boolean).join('／'),
    };
    return done(kind, issue, [[file, next]], set, takedown, f.reason);
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
  };
  return done(kind, issue, [[`manual/${id}.json`, ev]], null, false, f.reason);
}

function done(kind, issue, files, set, takedown, reason) {
  const lines = kind === 'edit'
    ? [
        ...(set ? Object.entries(set).map(([k, v]) => `- \`${k}\`：${v}`) : []),
        ...(takedown ? ['- **從行事曆上拿掉**（`hidden: true`，資料仍保留，改回 false 就恢復）'] : []),
      ]
    : [`- ${files[0][1].title}（${files[0][1].date_start}）`];
  return {
    ok: true, kind, files,
    title: `${kind === 'edit' ? '修改' : '新增'}：${issue.title.replace(/^(修改|新增)[:：]\s*/, '')}`.slice(0, 120),
    body: [
      `由 #${issue.number} 自動產生。合併之後，網站與訂閱日曆幾分鐘內更新。`,
      '',
      ...lines,
      '',
      `**理由**：${(reason ?? '').slice(0, 1000)}`,
      '',
      `Closes #${issue.number}`,
    ].join('\n'),
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

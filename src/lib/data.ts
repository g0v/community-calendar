// 建置時讀 events/ 與 overrides/，套上管理員的修正（邏輯在 scripts/resolve.mjs，同步與網站共用一份）
import { loadAiMonday, loadAll, resolve } from '../../scripts/resolve.mjs';

import { execFileSync } from 'node:child_process';
import site from '../../config/site.json' with { type: 'json' };

export const REPO = 'https://github.com/g0v/community-calendar';
export const CONTACT_EMAIL = site.contact_email;
export const SOURCE_URL = 'https://g0v.hackmd.io/@jothon/event';

export interface SubSession { name: string; date: string | null; start_time: string | null; end_time: string | null; venue: string | null }
export interface Event {
  id: string; source: string; source_url: string;
  title: string;
  date_start: string | null; date_end: string | null; date_precision: 'day' | 'month' | 'year';
  start_time: string | null; end_time: string | null;
  venue: string | null; address: string | null; host: string | null;
  signup_url: string | null; notes_url: string | null; page_url: string | null; online_url?: string | null;
  sub_sessions: SubSession[];
  fields: Record<string, string>;
  links: string[];
  description: string[];
  month_section: string | null;
  raw: string;
  warnings: string[];
  first_seen: string; in_source: boolean; removed_from_source: string | null;
  status?: string | null; // 只有 AI Monday 來源有：已排定／已完成／邀約中／停辦
  // 小松果（g0v 台北社群空間使用紀錄）上的編號與成果共筆
  hsiaothon?: { no: number; year: number; notes_url: string | null; line: string };
  // resolve() 加上的
  override?: { hidden?: boolean; jothon?: boolean; series?: string | null; set?: Record<string, unknown>; note?: string };
  hidden: boolean; jothon: boolean; jothon_source: 'override' | 'aimonday' | null; jothon_pending: boolean;
  aimonday_id: string | null; aimonday_url: string | null; cancelled: boolean; has_override: boolean;
  talks?: { title: string | null; speakers: string[]; url: string }[];
  // facets()：篩選用，推不出來就是 null／空陣列
  series: string | null; series_label: string | null; cities: string[]; online: boolean;
}

let cache: Promise<Event[]> | undefined;
export function getEvents(): Promise<Event[]> {
  cache ??= (async () => {
    const { events, overrides } = await loadAll(process.cwd());
    return resolve(events, overrides, await loadAiMonday()) as Event[];
  })();
  return cache;
}

// ---------- 這筆資料的紀錄 ----------
//
// 一場活動的資料分散在 events/{id}.json（同步寫的）、overrides/{id}.json（修正）、manual/{id}.json（網站新增的），
// GitHub 一次只能看一個檔案的歷史。所以建置時跑一次 git log，把三個檔案的修改依時間合在一起，放在活動頁上
export interface HistoryEntry { date: string; kind: string; text: string; url: string }

let historyCache: Map<string, HistoryEntry[]> | undefined;
export function historyOf(id: string): HistoryEntry[] {
  historyCache ??= loadHistory();
  return historyCache.get(id) ?? [];
}

function loadHistory() {
  const map = new Map<string, HistoryEntry[]>();
  let out = '';
  try {
    out = execFileSync('git', ['log', '--date=short', '--format=@@%H%x1f%ad%x1f%s%x1f%b%x1e', '--name-only', '--', 'events', 'overrides', 'manual'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch { return map; } // 不是 git 目錄（例如只有 dist 的環境）就不顯示
  for (const chunk of out.split('@@').slice(1)) {
    const [meta, files = ''] = chunk.split('\x1e');
    const [hash, date, subject, body = ''] = meta.split('\x1f');
    const issue = /由 #(\d+) 自動產生/.exec(body)?.[1];
    const { kind, text } = describe(subject, !!issue);
    const entry = { date, kind, text, url: issue ? `${REPO}/issues/${issue}` : `${REPO}/commit/${hash}` };
    for (const f of files.split('\n').map((x) => x.trim()).filter(Boolean)) {
      const m = /^(events|overrides|manual)\/(.+)\.json$/.exec(f);
      if (!m) continue;
      const list = map.get(m[2]) ?? [];
      // 同一個 commit 同時改了 events/ 與 overrides/ 只記一次
      if (!list.some((x) => x.url === entry.url && x.date === entry.date)) list.push({ ...entry, kind: m[1] === 'overrides' && !issue ? '管理員修正' : entry.kind });
      map.set(m[2], list);
    }
  }
  // git log 由新到舊，最後一筆就是第一次出現
  for (const list of map.values()) {
    const first = list[list.length - 1];
    first.kind = first.kind === '網站上的修改' ? '從網站新增' : '第一次收錄';
  }
  return map;
}

function describe(subject: string, fromIssue: boolean) {
  if (fromIssue) return { kind: '網站上的修改', text: subject };
  if (subject.startsWith('sync:')) return { kind: '共筆同步', text: '活動共筆上的內容有更新' };
  if (/^data: .*(網路檔案館|版本歷史|小松果)/.test(subject)) return { kind: '補資料', text: subject.replace(/^data:\s*/, '') };
  if (subject.startsWith('data:')) return { kind: '資料整理', text: subject.replace(/^data:\s*/, '') };
  return { kind: '資料整理', text: subject.replace(/^\w+:\s*/, '') };
}

// 「今天」以台灣時間算；網站每天跟著同步重建，所以建置當下的日期就夠準
export const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

export const fromAiMonday = (e: Event) => e.source === 'aimonday';
// AI Monday 還在邀約講者的空場次：時間未定
export const tentative = (e: Event) => e.status === '邀約中';

export const isPast = (e: Event) => !!e.date_start && (e.date_end ?? e.date_start) < today;

// 活動日還沒到就從共筆消失：可能取消、也可能誤刪，看不出來。先保留並標出來（2026-10-09 的暫定作法）
export const vanishedEarly = (e: Event) => !e.in_source && !!e.removed_from_source && !!e.date_start && e.removed_from_source <= (e.date_end ?? e.date_start);

const WEEK = '日一二三四五六';
const weekday = (d: string) => WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()];
const md = (d: string) => { const [, m, dd] = d.split('-').map(Number); return `${m}/${dd}`; };

export function formatWhen(e: Event) {
  if (e.date_precision === 'year') return '日期待確認';
  if (e.date_precision === 'month') return `${e.month_section!.replace('-', ' 年 ').replace(/ 0?(\d+)$/, ' $1')} 月（日期未定）`;
  const s = e.date_start!;
  const y = s.slice(0, 4);
  const range = e.date_end ? `${md(s)}（${weekday(s)}）–${md(e.date_end)}（${weekday(e.date_end)}）` : `${md(s)}（${weekday(s)}）`;
  const time = e.start_time ? (e.end_time ? ` ${e.start_time}–${e.end_time}` : ` ${e.start_time} 開始`) : '';
  return `${y}/${range}${time}`;
}

// ---------- 日曆 ----------

export const monthOf = (date: string) => date.slice(0, 7);

// 有活動的第一個月到最後一個月（含今天所在的月），每個月「YYYY-MM」
export function calendarMonths(events: Event[]) {
  const all = [...events.filter((e) => e.date_start).map((e) => monthOf(e.date_start!)), monthOf(today)].sort();
  const months: string[] = [];
  for (let m = all[0]; m <= all[all.length - 1]; m = shiftMonth(m, 1)) months.push(m);
  return months;
}

export function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 月曆格子：週日開頭，前後補滿成整週。每格是「YYYY-MM-DD」，不在本月的格子為 null
export function monthGrid(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

// 這一天有沒有這場活動：跨天的活動每一天都算；分城市辦的大松算在各子場次那天
export function onDate(e: Event, d: string) {
  if (!e.date_start || e.date_precision !== 'day') return false;
  const subs = e.sub_sessions.filter((s) => s.date);
  if (subs.length) return subs.some((s) => s.date === d);
  return e.date_start <= d && d <= (e.date_end ?? e.date_start);
}

export const monthKey = (e: Event) => e.date_start?.slice(0, 7) ?? e.month_section ?? '未定';

// GitHub 上這筆資料的修改紀錄與回報入口。AI Monday 來源的資料不在這個 repo，修改紀錄在 civictech-tw-data
export const historyUrl = (e: Event) => (fromAiMonday(e) ? null : `${REPO}/commits/main/events/${e.id}.json`);
// 網站上的編輯頁與新增活動頁送出時開的 issue（表單在 .github/ISSUE_TEMPLATE/，欄位用 id 預先填好）
export function issueUrl(template: 'edit-event.yml' | 'new-event.yml', title: string, fields: Record<string, string>) {
  const q = new URLSearchParams({ template, title });
  for (const [k, v] of Object.entries(fields)) if (v) q.set(k, v);
  return `${REPO}/issues/new?${q}`;
}

// 給管理員的捷徑：直接在 GitHub 改 overrides/{id}.json。改的是 overrides/{id}.json，不是 events/——events/ 會被每日同步重寫，overrides 不會。
// 已經有修正檔就打開它編輯；還沒有就打開 GitHub 的新增檔案畫面，檔名與範本都填好。
// 沒有 repo 寫入權限的人按同一個按鈕，GitHub 會自動幫他開成 PR，管理員合併就生效
export function editUrl(e: Event) {
  if (e.has_override) return `${REPO}/edit/main/overrides/${e.id}.json`;
  const template = JSON.stringify({ note: '為什麼要改（給管理員看）', hidden: false, set: { title: e.title } }, null, 2) + '\n';
  return `${REPO}/new/main/overrides?filename=${encodeURIComponent(`${e.id}.json`)}&value=${encodeURIComponent(template)}`;
}

export function reportUrl(e: Event) {
  const body = [
    `活動：${e.title}（\`${e.id}\`）`,
    '',
    '哪裡有問題？（例如資料錯誤、活動已取消、內容不適合放在這裡）',
    '',
    '',
    '---',
    '管理員處理方式：在 `overrides/' + e.id + '.json` 修正欄位或標 `"hidden": true`，見 README。',
  ].join('\n');
  return `${REPO}/issues/new?title=${encodeURIComponent(`回報：${e.title}`)}&body=${encodeURIComponent(body)}`;
}

// 站內連結都經過這裡，之後換網址（base）時只改 astro.config
export const href = (p: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${p}`;

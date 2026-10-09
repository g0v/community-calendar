// 建置時讀 events/ 與 overrides/，套上管理員的修正（邏輯在 scripts/resolve.mjs，同步與網站共用一份）
import { loadAiMonday, loadAll, resolve } from '../../scripts/resolve.mjs';

export const REPO = 'https://github.com/g0v/community-calendar';
export const SOURCE_URL = 'https://g0v.hackmd.io/@jothon/event';

export interface SubSession { name: string; date: string | null; start_time: string | null; end_time: string | null; venue: string | null }
export interface Event {
  id: string; source: string; source_url: string;
  title: string;
  date_start: string | null; date_end: string | null; date_precision: 'day' | 'month' | 'year';
  start_time: string | null; end_time: string | null;
  venue: string | null; address: string | null; host: string | null;
  signup_url: string | null; notes_url: string | null; page_url: string | null;
  sub_sessions: SubSession[];
  fields: Record<string, string>;
  links: string[];
  description: string[];
  month_section: string | null;
  raw: string;
  warnings: string[];
  first_seen: string; in_source: boolean; removed_from_source: string | null;
  // resolve() 加上的
  hidden: boolean; jothon: boolean; jothon_source: 'override' | 'aimonday' | null; jothon_pending: boolean; aimonday_id: string | null;
}

let cache: Promise<Event[]> | undefined;
export function getEvents(): Promise<Event[]> {
  cache ??= (async () => {
    const { events, overrides } = await loadAll(process.cwd());
    return resolve(events, overrides, await loadAiMonday()) as Event[];
  })();
  return cache;
}

// 「今天」以台灣時間算；網站每天跟著同步重建，所以建置當下的日期就夠準
export const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

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

export const monthKey = (e: Event) => e.date_start?.slice(0, 7) ?? e.month_section ?? '未定';

// GitHub 上這筆資料的修改紀錄與回報入口
export const historyUrl = (e: Event) => `${REPO}/commits/main/events/${e.id}.json`;
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

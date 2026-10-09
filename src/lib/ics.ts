// 可訂閱的日曆（RFC 5545）。改寫自 g0v/AI-Monday 的 calendar.ics.ts。
//
// 收什麼：
//   - 只收日期確定到「哪一天」的。只知道月份、或寫著「日期待確認」的不收
//   - 管理員下架（hidden）的不收
//   - 活動日還沒到就從共筆消失的：照收，標題前加「（共筆已移除）」。可能是取消、也可能是誤刪，
//     看不出來，所以先讓訂閱的人看得到變化，而不是讓它安靜消失（2026-10-09 暫定，要改只改 summary()）
//   - 有子場次的（大松分城市）：每個子場次一個事件
//
// UID：AI Monday 場次沿用 AI-Monday 日曆的 UID（{id}@aimonday.g0v），其他用 {id}@community-calendar.g0v。
// id 第一次看到時就定了、之後不變，所以標題或日期被改，訂閱者的日曆會更新那一筆，不會多出一筆。
import { type Event, href, vanishedEarly } from './data';

export interface Feed { name: string; desc: string; filter: (e: Event) => boolean }

export function buildIcs(events: Event[], feed: Feed, site: URL | undefined) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const base = site ? new URL(href('/'), site).href : null;

  const vevents = events
    .filter((e) => !e.hidden && e.date_precision === 'day' && e.date_start && feed.filter(e))
    .flatMap((e) => {
      const uid = e.aimonday_id ? `${e.aimonday_id}@aimonday.g0v` : `${e.id}@community-calendar.g0v`;
      const page = base && `${base}events/${e.id}/`;
      const desc = [
        e.signup_url && `報名：${e.signup_url}`,
        e.notes_url && `共筆：${e.notes_url}`,
        e.page_url && `活動頁：${e.page_url}`,
        e.start_time && !e.end_time && '結束時間未定',
        vanishedEarly(e) && `這場活動在 ${e.removed_from_source} 從揪松團的活動共筆上被移除，可能已取消，請向主辦單位確認。`,
        page && `更多資訊：${page}`,
      ].filter(Boolean).join('\n');
      const location = [e.venue, e.address].filter(Boolean).join('／') || null;
      const common = { desc, page, stamp, location };

      const subs = e.sub_sessions.filter((s) => s.date);
      if (subs.length) {
        return subs.map((s, i) => vevent({
          ...common, uid: uid.replace('@', `-${i + 1}@`), title: `${summary(e)}｜${s.name}`,
          date: s.date!, end: null, start: s.start_time, finish: s.end_time, location: s.venue ?? location,
        }));
      }
      return [vevent({ ...common, uid, title: summary(e), date: e.date_start!, end: e.date_end, start: e.start_time, finish: e.end_time })];
    });

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//g0v//community-calendar//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${text(feed.name)}`,
    'X-WR-TIMEZONE:Asia/Taipei',
    `X-WR-CALDESC:${text(feed.desc)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    // 台灣沒有日光節約時間，一段 STANDARD 就夠
    'BEGIN:VTIMEZONE', 'TZID:Asia/Taipei',
    'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0800', 'TZOFFSETTO:+0800', 'TZNAME:CST', 'END:STANDARD',
    'END:VTIMEZONE',
    ...vevents.flat(),
    'END:VCALENDAR',
  ];
  return new Response(lines.map(fold).join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}

const summary = (e: Event) => (vanishedEarly(e) ? `（共筆已移除）${e.title}` : e.title);

interface V { uid: string; stamp: string; title: string; date: string; end: string | null; start: string | null; finish: string | null; desc: string; page: string | null; location: string | null }
function vevent(v: V) {
  // 有開始時間：當天的時段；只寫開始沒寫結束，就只給開始（不替它編一個結束時間）。
  // 沒有時間：全天，跨天的就到最後一天
  const when = v.start
    ? [`DTSTART;TZID=Asia/Taipei:${compact(v.date)}T${compact(v.start)}00`, ...(v.finish ? [`DTEND;TZID=Asia/Taipei:${compact(v.date)}T${compact(v.finish)}00`] : [])]
    : [`DTSTART;VALUE=DATE:${compact(v.date)}`, `DTEND;VALUE=DATE:${compact(nextDay(v.end ?? v.date))}`];
  return [
    'BEGIN:VEVENT',
    `UID:${v.uid}`,
    `DTSTAMP:${v.stamp}`,
    ...when,
    `SUMMARY:${text(v.title)}`,
    ...(v.desc ? [`DESCRIPTION:${text(v.desc)}`] : []),
    ...(v.location ? [`LOCATION:${text(v.location)}`] : []),
    ...(v.page ? [`URL:${v.page}`] : []),
    'END:VEVENT',
  ];
}

const compact = (s: string) => s.replace(/[-:]/g, '');
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
// TEXT 值的跳脫：反斜線、分號、逗號、換行
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// 每行最多 75 bytes，續行以一個空白開頭。中文一字 3 bytes，要以字為單位切，不能切在字中間
function fold(line: string) {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '', size = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ''; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

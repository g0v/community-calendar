// 把「大松小松活動訊息」共筆（g0v.hackmd.io/@jothon/event）的 Markdown 切成一筆一筆活動。
//
// 共筆的骨架：`### YYYY.MM` 是月份、`---` 分隔活動、每筆第一行是「日期＋標題」、底下 `- 鍵：值` 是欄位。
// 但它是誰都能編的共筆，所以這裡的原則是**容錯，但不默默修**：
//   - 認得出來的寫法都接受（日期至少六種寫法、同義欄名、日文欄名）
//   - 看起來有問題的（漏了 ---、時間地點對調、日期對不上）照原樣收進來，另外記一條 warning
//
// 只做「文字 → 結構」，不碰檔案、不碰網路，方便單獨測。累積保存與比對在 sync.mjs。

const MONTH_HEADING = /^###\s+(\d{4})\.(\d{1,2})\s*$/;
const SECTION_END = /^#{1,2}\s/; // 活動區之後是「## [每月 Monthly]」「## 工作討論區」…，都不是活動
const URL = /https?:\/\/[^\s)）>\]]+/g;

// 欄名 → 標準欄位。共筆上同一件事有好幾種寫法，日文活動用日文欄名
const KEYS = [
  ['time', /^(時間|活動時間|開催日時|日期|日時)$/],
  ['venue', /^(地點|活動地點.?|場地|開催場所.*|会場)$/],
  ['address', /^(地址|住所)$/],
  ['signup_url', /(報名|參加方法|参加方法|申込)/],
  ['notes_url', /(共筆|工作文件|籌備構想)/],
  ['host', /^(主辦|主辦單位|主催)$/],
  ['page_url', /^(詳細資訊|活動頁面|活動資訊|活動網址|線上活動網址|活動連結)$/],
];

const WEEKDAY = /^(?:週[一二三四五六日]|星期[一二三四五六日]|[（(][一二三四五六日][）)]|(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\.?)/;
const DAYPART = /^(?:上午下午晚上|上下午|上午|下午|中午|晚上|早上|全天)/;

export function parse(md) {
  const lines = md.split(/\r?\n/);
  const events = [];
  const warnings = [];
  let year = null, month = null, inSection = false, cur = null;

  const close = () => { if (cur) events.push(finish(cur, warnings)); cur = null; };

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    const lineNo = i + 1;
    const mh = line.match(MONTH_HEADING);
    if (mh) { close(); inSection = true; year = +mh[1]; month = +mh[2]; return; }
    if (!inSection) return;
    if (SECTION_END.test(line)) { close(); inSection = false; return; }
    if (/^-{3,}$/.test(line.trim())) { close(); return; }
    if (!line.trim()) { if (cur) cur.raw.push(raw); return; }
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(line.trim())) { if (cur) cur.raw.push(raw); return; } // 圖片
    if (/^\*\*[^*]+\*\*$/.test(line.trim()) && !cur) return; // 「**注意這個月是投票月**」這種月份備註

    const isBullet = /^\s*[-*]\s+/.test(line);
    if (!isBullet && !/^\s/.test(line)) {
      // 頂層的非列點文字＝新的一筆。前一筆還開著代表中間漏了 ---
      if (cur) {
        warnings.push({ line: lineNo, msg: `「${short(line)}」前面少了 ---，跟上一筆「${short(cur.header)}」黏在一起；已當成兩筆處理` });
        close();
      }
      cur = { header: line.trim(), line: lineNo, year, month, bullets: [], raw: [raw] };
      return;
    }
    if (!cur) return; // 不屬於任何活動的列點，例如月份底下的說明
    cur.raw.push(raw);
    if (isBullet) {
      const indent = line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
      cur.bullets.push({ indent, text: line.replace(/^\s*[-*]\s+/, '').trim(), line: lineNo });
    } else if (cur.bullets.length) {
      cur.bullets[cur.bullets.length - 1].text += ' ' + line.trim(); // 列點的續行
    }
  });
  close();
  return { events, warnings };
}

function finish(b, warnings) {
  const where = (msg) => warnings.push({ line: b.line, msg: `「${short(b.header)}」${msg}` });
  const head = parseHeader(b.header, b.year, b.month);
  const ev = {
    title: head.title,
    date_start: head.date_start,
    date_end: head.date_end,
    date_precision: head.precision,
    start_time: null,
    end_time: null,
    venue: null,
    address: null,
    signup_url: null,
    notes_url: null,
    page_url: null,
    host: null,
    sub_sessions: [],
    fields: {},
    links: [],
    description: [],
    month_section: b.year ? `${b.year}-${String(b.month).padStart(2, '0')}` : null,
    source_line: b.line,
    raw: b.raw.join('\n').trim(),
    warnings: [],
  };
  const warn = (msg) => { ev.warnings.push(msg); where(msg); };

  if (head.precision !== 'day') warn(head.precision === 'month' ? '沒有日期，只知道月份；不會放進訂閱日曆' : '日期待確認；不會放進訂閱日曆');
  if (head.month_mismatch) warn(`寫在 ${ev.month_section} 底下，但日期是 ${head.date_start}`);

  // 列點：`鍵：值`、`【鍵】值`、`[標籤](網址)`。沒有冒號又有下一層的，是群組（「活動資訊」）或子場次（「高雄場」）
  let session = null, sessionIndent = -1;
  b.bullets.forEach((bl, idx) => {
    if (session && bl.indent <= sessionIndent) session = null;
    const kv = splitKV(bl.text);
    const next = b.bullets[idx + 1];
    const hasChildren = next && next.indent > bl.indent;
    for (const u of bl.text.match(URL) ?? []) if (!ev.links.includes(u)) ev.links.push(u);

    if (!kv && hasChildren && /場$/.test(bl.text)) {
      session = { name: bl.text, date: null, start_time: null, end_time: null, venue: null };
      sessionIndent = bl.indent;
      ev.sub_sessions.push(session);
      return;
    }
    if (!kv) { if (!hasChildren && !/^https?:\/\/\S+$/.test(bl.text)) ev.description.push(bl.text); return; }

    const std = KEYS.find(([, re]) => re.test(kv.key))?.[0];
    if (session) {
      if (std === 'time') Object.assign(session, timeOf(kv.value), { date: dateIn(kv.value, ev.date_start) ?? session.date });
      else if (std === 'venue') session.venue = kv.value;
      else ev.fields[`${session.name}／${kv.key}`] = kv.value;
      return;
    }
    ev.fields[kv.key] = kv.value;
    if (!std) return;
    if (std.endsWith('_url')) { ev[std] ??= firstUrl(kv.value); return; }
    if (std === 'time') {
      const t = timeOf(kv.value);
      if (!ev.start_time && t.start_time) Object.assign(ev, t);
      const d = dateIn(kv.value, ev.date_start);
      if (d && ev.date_start && d !== ev.date_start && !(ev.date_end && d <= ev.date_end && d >= ev.date_start)) {
        warn(`標題的日期是 ${ev.date_start}，但「${kv.key}」寫的是 ${d}`);
      }
      return;
    }
    if (std === 'venue') { ev.venue = ev.venue ? `${ev.venue}；${kv.value}` : kv.value; return; }
    ev[std] ??= kv.value;
  });

  // 「時間」「地點」的值對調（2026-10 的 F4 真的發生過）：標出來，不替它修
  const t = ev.fields['活動時間'] ?? ev.fields['時間'];
  const v = ev.fields['活動地點'] ?? ev.fields['地點'];
  if (t && v && !/\d{1,2}[:：]\d{2}/.test(t) && /\d{1,2}[:：]\d{2}/.test(v) && /[路街號樓室]/.test(t)) {
    warn(`「時間」與「地點」的值好像對調了（時間：${short(t)}；地點：${short(v)}）`);
  }
  for (const s of ev.sub_sessions) s.date ??= dateIn(s.name, ev.date_start);
  return ev;
}

// ---------- 標題列 ----------

// 回傳 { date_start, date_end, precision: 'day'|'month'|'year', title }
export function parseHeader(header, ctxYear, ctxMonth) {
  let s = header.trim();
  const pending = /^\[月份日期待確認\]\s*/.exec(s);
  if (pending) s = s.slice(pending[0].length);

  let y, m, d, m2, d2, rest = null;
  const pats = [
    // 範本寫法：2026-10-14、2026-10-14~10-15
    [/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s*[~～]\s*(?:(\d{1,2})-)?(\d{1,2}))?/, (x) => [x[1], x[2], x[3], x[4], x[5]]],
    // 2026/11/08、2027/07/31-08/01
    [/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s*[-~～]\s*(?:(\d{1,2})\/)?(\d{1,2}))?/, (x) => [x[1], x[2], x[3], x[4], x[5]]],
    // 2027 1/09-1/10
    [/^(\d{4})\s+(\d{1,2})\/(\d{1,2})(?:\s*[-~～]\s*(?:(\d{1,2})\/)?(\d{1,2}))?/, (x) => [x[1], x[2], x[3], x[4], x[5]]],
    // 20261024
    [/^(\d{4})(\d{2})(\d{2})(?!\d)/, (x) => [x[1], x[2], x[3]]],
    // 10/01、10/3、7/17 週六 + 7/18 週日、11/04
    [/^(\d{1,2})\/(\d{1,2})(?!\d)/, (x) => [null, x[1], x[2]]],
  ];
  for (const [re, pick] of pats) {
    const x = re.exec(s);
    if (!x) continue;
    [y, m, d, m2, d2] = pick(x);
    rest = s.slice(x[0].length);
    break;
  }

  if (rest == null) {
    // 沒有日期：「暫定舉辦 Open Data Day Taiwan 2027」「[月份日期待確認] 2027 年…」
    const yy = /(\d{4})\s*年/.exec(s)?.[1];
    return pending || !ctxMonth
      ? { date_start: null, date_end: null, precision: 'year', year: +(yy ?? ctxYear), title: s }
      : { date_start: null, date_end: null, precision: 'month', month: `${ctxYear}-${pad(ctxMonth)}`, title: s };
  }

  // 「週六 + 7/18 週日」這種用加號接第二天的寫法
  rest = rest.replace(/^\s*/, '');
  rest = stripDecor(rest);
  const plus = /^[+＋&~～-]\s*(?:(\d{1,2})\/)?(\d{1,2})(?!\d)/.exec(rest);
  if (plus && !d2) { m2 = plus[1] ?? m; d2 = plus[2]; rest = stripDecor(rest.slice(plus[0].length)); }

  const year = +(y ?? ctxYear);
  const start = `${year}-${pad(m)}-${pad(d)}`;
  let end = null;
  if (d2) {
    let ey = year;
    if (+(m2 ?? m) < +m) ey += 1; // 12/31-1/1 跨年
    end = `${ey}-${pad(m2 ?? m)}-${pad(d2)}`;
  }
  const title = rest.replace(/^[\s，,、:：|｜▶︎\uFE0F]+/u, '').trim() || s;
  const month_mismatch = !!ctxMonth && +m !== ctxMonth && !(end && +(m2 ?? m) === ctxMonth);
  return { date_start: start, date_end: end, precision: 'day', title, month_mismatch };
}

function stripDecor(s) {
  for (let k = 0; k < 4; k++) {
    const before = s;
    s = s.replace(/^[\s，,]+/, '');
    s = s.replace(WEEKDAY, '').replace(/^\s*/, '').replace(DAYPART, '');
    if (s === before) break;
  }
  return s.replace(/^\s+/, '');
}

// ---------- 欄位 ----------

function splitKV(text) {
  const t = text.replace(/^[\p{Extended_Pictographic}\p{So}️‍▶︎＊*\s]+/u, '');
  let x = /^【([^】]{1,12})】\s*(.*)$/.exec(t);
  if (x) return { key: x[1].trim(), value: x[2].replace(/【[^】]*】\s*$/, '').trim() };
  x = /^\[([^\]]{1,20})\]\((https?:\/\/[^)]+)\)\s*$/.exec(t);
  if (x) return { key: x[1].trim(), value: x[2] };
  x = /^([^：:]{1,16}?)\s*[：:]\s*(.*)$/.exec(t);
  if (x && !/https?$/i.test(x[1]) && !/^https?/i.test(x[1])) return { key: x[1].replace(/\s+/g, ''), value: x[2].trim() };
  return null;
}

const firstUrl = (s) => (s.match(URL) ?? [null])[0];

// 「13:30–17:00」「19:30-21:30」「10:30 〜 18:00」「14:00~16:00」；只寫開始也收
export function timeOf(s) {
  const r = /(\d{1,2})[:：](\d{2})\s*(?:[-–—~～〜]|to)\s*(\d{1,2})[:：](\d{2})/.exec(s);
  if (r) return { start_time: `${pad(r[1])}:${r[2]}`, end_time: `${pad(r[3])}:${r[4]}` };
  const one = /(?<!\d)(\d{1,2})[:：](\d{2})(?!\d)/.exec(s);
  return { start_time: one ? `${pad(one[1])}:${one[2]}` : null, end_time: null };
}

// 欄位值裡的日期（用來跟標題對帳、或給子場次用）。沒寫年份就沿用標題的年份
export function dateIn(s, ref) {
  const refYear = ref ? +ref.slice(0, 4) : null;
  let x = /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/.exec(s);
  if (x) return `${x[1]}-${pad(x[2])}-${pad(x[3])}`;
  x = /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/.exec(s);
  if (x) return `${x[1]}-${x[2]}-${x[3]}`;
  x = /(\d{4})\s*年\s*(\d{1,2})\/(\d{1,2})/.exec(s);
  if (x) return `${x[1]}-${pad(x[2])}-${pad(x[3])}`;
  x = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/.exec(s);
  if (x && refYear) return `${refYear}-${pad(x[1])}-${pad(x[2])}`;
  return null;
}

const pad = (n) => String(n).padStart(2, '0');
const short = (s) => (s.length > 28 ? s.slice(0, 28) + '…' : s);

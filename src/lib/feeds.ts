// 所有可訂閱的日曆，定義在 config/feeds.json（一段一份）。訂閱頁與 .ics 端點都從這裡讀，名單只有一份
import config from '../../config/feeds.json' with { type: 'json' };
import type { Event } from './data';
import type { Feed } from './ics';

interface Match { jothon?: boolean; series?: string[]; keywords?: string[] }
interface Raw { file?: string; url?: string; title: string; hint?: string; name?: string; desc: string; match?: Match }
export interface FeedInfo extends Feed { file?: string; url?: string; title: string; hint?: string }

const matches = (m: Match = {}) => (e: Event) =>
  (m.jothon === undefined || e.jothon === m.jothon)
  && (!m.series?.length || m.series.includes(e.series ?? ''))
  && (!m.keywords?.length || m.keywords.some((k) => e.title.toLowerCase().includes(k.toLowerCase())));

export const FEEDS: FeedInfo[] = (config.feeds as Raw[]).map((f) => ({
  ...f,
  name: f.name ?? f.title,
  filter: matches(f.match),
}));

// 這個網站自己產生的（有 file 的）；有 url 的是別人的日曆，只在訂閱頁放連結
export const OWN_FEEDS = FEEDS.filter((f) => f.file);

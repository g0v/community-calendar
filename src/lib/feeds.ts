// 所有可訂閱的日曆：主要兩份（揪松、全部）＋每個系列一份。訂閱頁與 .ics 端點都從這裡讀，名單只有一份
import { SERIES } from '../../scripts/facets.mjs';
import type { Event } from './data';
import type { Feed } from './ics';

export interface FeedInfo extends Feed { path: string; external?: string }

export const MAIN_FEEDS: FeedInfo[] = [
  {
    path: 'jothon.ics', name: 'g0v 揪松團活動',
    desc: '揪松團主辦的活動：黑客松（大松）、AI Monday、放輕松、跑咖松。',
    filter: (e) => e.jothon,
  },
  {
    path: 'all.ics', name: 'g0v 社群活動',
    desc: '揪松團「大松小松活動訊息」共筆上的所有活動，加上 AI Monday。共筆開放社群自由填寫，內容未經審核。',
    filter: () => true,
  },
];

// AI Monday 已經有自己的訂閱網址、也已經有人訂了。這裡不再產生第二份，免得訂閱的人分散在兩個網址
const EXTERNAL: Record<string, string> = { 'ai-monday': 'https://g0v.github.io/AI-Monday/calendar.ics' };

// 資料裡真的有的系列才產生，依活動數多到少
export function seriesFeeds(events: Event[]): (FeedInfo & { slug: string; count: number })[] {
  return SERIES.map(([slug, label]) => ({ slug, label, count: events.filter((e) => !e.hidden && e.series === slug).length }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(({ slug, label, count }) => ({
      slug, count,
      path: `series/${slug}.ics`,
      external: EXTERNAL[slug],
      name: `${label}｜g0v 社群行事曆`,
      desc: `g0v 社群行事曆上「${label}」系列的活動。`,
      filter: (e: Event) => e.series === slug,
    }));
}

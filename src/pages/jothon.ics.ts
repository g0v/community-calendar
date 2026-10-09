import type { APIRoute } from 'astro';
import { getEvents } from '../lib/data';
import { buildIcs } from '../lib/ics';

// 只收管理員確認過是揪松主辦的（大松、AI Monday、放輕松、跑咖松），見 scripts/resolve.mjs
export const GET: APIRoute = async ({ site }) =>
  buildIcs(await getEvents(), {
    name: 'g0v 揪松團活動',
    desc: 'g0v 揪松團主辦的活動：黑客松（大松）、AI Monday、放輕松、跑咖松。',
    filter: (e) => e.jothon,
  }, site);

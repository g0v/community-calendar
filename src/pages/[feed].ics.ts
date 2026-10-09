import type { APIRoute } from 'astro';
import { getEvents } from '../lib/data';
import { OWN_FEEDS } from '../lib/feeds';
import { buildIcs } from '../lib/ics';

// 每一份可訂閱的日曆。有哪些、收什麼，定義在 config/feeds.json
export function getStaticPaths() {
  return OWN_FEEDS.map((f) => ({ params: { feed: f.file!.replace(/\.ics$/, '') } }));
}

export const GET: APIRoute = async ({ params, site }) =>
  buildIcs(await getEvents(), OWN_FEEDS.find((f) => f.file === `${params.feed}.ics`)!, site);

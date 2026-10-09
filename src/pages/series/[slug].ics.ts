import type { APIRoute } from 'astro';
import { getEvents } from '../../lib/data';
import { seriesFeeds } from '../../lib/feeds';
import { buildIcs } from '../../lib/ics';

// 每個系列一份可訂閱的日曆。已經有自己訂閱網址的系列（AI Monday）不產生，見 feeds.ts
export async function getStaticPaths() {
  return seriesFeeds(await getEvents()).filter((f) => !f.external).map((f) => ({ params: { slug: f.slug } }));
}

export const GET: APIRoute = async ({ params, site }) => {
  const events = await getEvents();
  const feed = seriesFeeds(events).find((f) => f.slug === params.slug)!;
  return buildIcs(events, feed, site);
};

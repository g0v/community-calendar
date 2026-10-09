import type { APIRoute } from 'astro';
import { getEvents } from '../lib/data';
import { MAIN_FEEDS } from '../lib/feeds';
import { buildIcs } from '../lib/ics';

// 名稱、說明與收哪些活動，定義在 lib/feeds.ts
export const GET: APIRoute = async ({ site }) => buildIcs(await getEvents(), MAIN_FEEDS[1], site);

import type { APIRoute } from 'astro';
import { getEvents } from '../lib/data';
import { buildIcs } from '../lib/ics';

export const GET: APIRoute = async ({ site }) =>
  buildIcs(await getEvents(), {
    name: 'g0v 社群活動',
    desc: '揪松團「大松小松活動訊息」共筆上的所有活動。共筆開放社群自由填寫，內容未經審核。',
    filter: () => true,
  }, site);

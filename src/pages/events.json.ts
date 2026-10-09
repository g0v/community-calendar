import type { APIRoute } from 'astro';
import { getEvents } from '../lib/data';

// 開放資料：網站上看得到的每一筆（已下架的不收）。原始累積資料在 repo 的 events/
export const GET: APIRoute = async () => {
  const records = (await getEvents()).filter((e) => !e.hidden).map(({ hidden, raw, ...e }) => e);
  return new Response(JSON.stringify({ generated_at: new Date().toISOString(), recordCount: records.length, records }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};

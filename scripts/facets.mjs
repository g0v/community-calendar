// 篩選用的欄位：系列、城市、線上。共筆沒有這些欄位，從標題與地點推出來；推不出來就不標（null），不猜。
//
// 系列的判斷規則在 config/series.json（關鍵字，不用會寫程式也能改）。城市與線上的規則比較少變，留在這裡。
import seriesConfig from '../config/series.json' with { type: 'json' };

export const SERIES = seriesConfig.series.map((s) => [s.slug, s.name]);

const has = (title, words = []) => words.some((w) => title.includes(w.toLowerCase()));
export function seriesOf(title) {
  const t = title.toLowerCase();
  return seriesConfig.series.find((s) => has(t, s.keywords) && !has(t, s.exclude)) ?? null;
}

// 地名 → 縣市。只認得明確的地名與常用場地，認不出來就不標
const CITY = [
  ['台北', /台北|臺北|NPO\s*HUB|NPOHUB|摩茲工寮|重慶南路|中正區|信義區|中山區|大安區|萬華|士林|中研院|集思台大|C-LAB|BEONE|Impact Hub|華山|g0v 台北社群空間/i],
  ['新北', /新北|板橋|三重|新店|淡水/],
  ['桃園', /桃園|中壢/],
  ['新竹', /新竹/],
  ['台中', /台中|臺中|逢甲/],
  ['南投', /南投|埔里/],
  ['嘉義', /嘉義/],
  ['台南', /台南|臺南/],
  ['高雄', /高雄|左營/],
  ['屏東', /屏東/],
  ['宜蘭', /宜蘭|頭城|羅東/],
  ['花蓮', /花蓮/],
  ['台東', /台東|臺東/],
  ['連江', /馬祖|連江|南竿/],
  ['海外', /東京|日本|Japan|Seoul|首爾|美西|灣區|bay\s*area/i],
];

const ONLINE = /線上|online|webex|google\s*meet|meet\.google|zoom|hybrid|直播/i;

export function facets(e) {
  const series = seriesOf(e.title);
  const where = [e.venue, e.address, ...(e.sub_sessions ?? []).map((s) => s.venue), e.title].filter(Boolean).join(' ');
  const cities = [...new Set(CITY.filter(([, re]) => re.test(where)).map(([c]) => c))];
  return {
    series: series?.slug ?? null,
    series_label: series?.name ?? null,
    cities,
    online: ONLINE.test([e.venue, e.title, ...Object.values(e.fields ?? {})].filter(Boolean).join(' ')),
  };
}

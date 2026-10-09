// 篩選用的欄位：系列、城市、線上。共筆沒有這些欄位，從標題與地點推出來；推不出來就不標（null），不猜。
//
// 規則表依序比對，先中先贏，所以「OpenStreetMap x Wikidata」要排在「維基」前面、國會松要排在大松前面
// （國會松的標題常常也有「黑客松」）。

export const SERIES = [
  ['ai-monday', 'AI Monday', /ai\s*monday/i],
  ['congressthon', '國會松', /國會松|congressthon/i],
  ['resilience', '數位韌性松', /韌性松/],
  ['facing-ocean', '面海松', /面海松|facing the ocean/i],
  ['hackathon', '大松', /黑客松|hackath\w*n/i],
  ['rand0mthon', '放輕松', /放輕松|rand0mth/i],
  ['cafethon', '跑咖松', /跑咖松/],
  ['osm-wikidata', 'OpenStreetMap × Wikidata 月聚會', /openstreetmap|osm\s*x/i],
  ['f4', 'F4 Functional Thursday', /functional\s*thursday|\bF4\b/i],
  ['internet-freedom', '網路自由小聚', /網路自由小聚/],
  ['civictech-day', '公民科技主題日', /公民科技主題日|civic\s*tech\s*on/i],
  ['wikidata', '維基數據', /維基|wikidata|wikimedia|ESEAP/i],
  ['tipf', 'TIPF 台灣國際攝影節', /TIPF/],
  ['coscup', 'COSCUP', /coscup/i],
  ['code-for-japan', 'Code for Japan', /code\s*for\s*japan/i],
];

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
  const series = SERIES.find(([, , re]) => re.test(e.title));
  const where = [e.venue, e.address, ...(e.sub_sessions ?? []).map((s) => s.venue), e.title].filter(Boolean).join(' ');
  const cities = [...new Set(CITY.filter(([, re]) => re.test(where)).map(([c]) => c))];
  return {
    series: series?.[0] ?? null,
    series_label: series?.[1] ?? null,
    cities,
    online: ONLINE.test([e.venue, e.title, ...Object.values(e.fields ?? {})].filter(Boolean).join(' ')),
  };
}

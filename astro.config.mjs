// @ts-check
import { defineConfig } from 'astro/config';

// 先放在 GitHub Pages（g0v.github.io/community-calendar/）。之後要換自己的網域，GitHub Pages 會把
// github.io 的網址轉過去，已經訂閱日曆的人不受影響；會讓訂閱斷掉的只有 repo 改名。
// 站內連結都經過 src/lib/data.ts 的 href()，換 base 不用改別的地方。
export default defineConfig({
  site: process.env.SITE ?? 'https://g0v.github.io',
  base: process.env.BASE ?? '/community-calendar',
  trailingSlash: 'always',
});

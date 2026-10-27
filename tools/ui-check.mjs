// 今の画面を状態ごとに撮り、測る（開発用。直す前と後を同じ物差しで比べる。決め方は CLAUDE.md）。
//
//   node tools/ui-check.mjs 出力フォルダ [--view 1536x864] [--views all] [--themes light,dark] [--states first,date]
//
// 撮った画像は 状態-テーマ-大きさ.png、測った量は metrics.json（測る量は ui-harness.mjs の measure）。
// --views all で CLAUDE.md の 3 つの大きさ（1728×1152・1536×864・1280×720）をまとめて撮る。案どうしを比べるときは ui-variants.mjs。

import fs from 'node:fs';
import path from 'node:path';
import { launch, measure, parseView, STATES, VIEWS } from './ui-harness.mjs';

const [outArg, ...rest] = process.argv.slice(2);
if (!outArg) {
  console.error('使い方: node tools/ui-check.mjs 出力フォルダ [--view 1536x864] [--views all] [--themes light,dark] [--states first,date]');
  process.exit(2);
}
const option = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const OUT = path.resolve(outArg);
const views = option('views', '') === 'all' ? Object.keys(VIEWS) : [option('view', '1728x1152')];
const themes = option('themes', 'light').split(',');
const only = option('states', '').split(',').filter(Boolean);
const states = STATES.filter((s) => !only.length || only.includes(s.name));

const app = await launch();
const report = {};
try {
  fs.mkdirSync(OUT, { recursive: true });
  for (const v of views) {
    for (const theme of themes) {
      for (const state of states) {
        const page = await app.newPage(state, parseView(v), theme);
        const id = `${state.name}-${theme}-${v}`;
        await page.screenshot({ path: path.join(OUT, `${id}.png`) });
        report[id] = await page.evaluate(measure);
        console.log(id, JSON.stringify(report[id]));
        await page.context().close();
      }
    }
  }
} finally {
  await app.close();
}
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(report, null, 1));

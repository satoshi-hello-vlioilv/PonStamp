// かすれの効き方の評価関数（開発用）: 本物の描き方（app/js/stamp.js）で、かすれ 0〜100 を 10 刻みに描き、枠と字の欠け方を分けて測る。
//
//   node tools/kasure-eval.mjs [--json 出力.json]
//
// かすれの形（利用者が決めた。2026-11-04）: 字が読めなくならないよう、枠の縁が欠ける形にする。
// 測る物（3 種類の印 × 模様 4 通りの平均。かすれ 0 の印と比べる。枠と字が重なる画素は数えない）:
//   枠の欠け   かすれ 0 で枠・線のインクのある画素のうち、ほとんど消えた（不透明度 1/8 未満）画素の割合（%）
//   字の欠け   同じく字のインクの画素のうち、ほとんど消えた画素の割合（%）
//   縁から     枠の欠けのうち、インクの外（地）とつながっている画素の割合（%）。縁から食い込む欠けは高く、中の点々の穴は低い
// 基準:
//   既定の 10 で枠は少し欠ける（0.3〜4%）・字はほぼ欠けない（≤ 0.3%）
//   いちばん強い 100 で枠ははっきり欠ける（12〜40%）・字は読める（≤ 3%）
//   枠の欠けは強さに沿って増える（単調・一次の当てはまり R² ≥ 0.95・10 刻みの増え方の最大 ÷ 平均 ≤ 2.5。急に効かない）
//   欠けは縁から（50 と 100 で 縁から ≥ 85%）
// 基準を外れた所を FAIL と出し、終了コード 1 を返す。

import fs from 'node:fs';
import { launch, SEED, STATES } from './ui-harness.mjs';

export const LIMITS = {
  frameAtDefault: [0.3, 4], textAtDefault: 0.3, frameAtMax: [12, 40], textAtMax: 3, r2: 0.95, stepRatio: 2.5, rim: 85,
};
const rest = process.argv.slice(2);
const opt = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : null; };
const PX = 400;
const LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const STAMPS = [{ type: 'mitome', name: '山田' }, { type: 'date', name: '山田', dept: '総務課' }, { type: 'square', square: '株式会社見本之印' }];
const SEEDS = [1, 2, 3, 4];

const app = await launch();
let rows;
try {
  const page = await app.newPage({ ...STATES[1], seed: SEED }, { width: 1000, height: 800 });
  rows = await page.evaluate(async ({ px, levels, stamps, seeds }) => {
    const alpha = async (s, parts) => (await window.__ps.drawStamp(s, px, { parts })).getContext('2d').getImageData(0, 0, px, px).data;
    const out = levels.map((k) => ({ k, frame: 0, text: 0, rim: 0 }));
    const n = stamps.length * seeds.length;
    for (const st of stamps) for (const seed of seeds) {
      const plain = { ...st, kasure: 0, tilt: 0, seed };
      const f0 = await alpha(plain, 'frame'), t0 = await alpha(plain, 'text');
      const isF = (i) => f0[i * 4 + 3] > 127 && t0[i * 4 + 3] <= 127;
      const isT = (i) => t0[i * 4 + 3] > 127 && f0[i * 4 + 3] <= 127;
      const ground = (i) => f0[i * 4 + 3] <= 127 && t0[i * 4 + 3] <= 127;
      let nf = 0, nt = 0;
      for (let i = 0; i < px * px; i++) { if (isF(i)) nf++; if (isT(i)) nt++; }
      for (const row of out) {
        const d = await alpha({ ...plain, kasure: row.k }, 'all');
        const gone = (i) => d[i * 4 + 3] < 32;
        let hf = 0, ht = 0;
        for (let i = 0; i < px * px; i++) { if (isF(i) && gone(i)) hf++; if (isT(i) && gone(i)) ht++; }
        // 地から、消えた枠の画素を伝ってたどれる所（縁から食い込んだ欠け）
        const seen = new Uint8Array(px * px), stack = [];
        for (let i = 0; i < px * px; i++) if (ground(i)) { seen[i] = 1; stack.push(i); }
        let rim = 0;
        while (stack.length) {
          const i = stack.pop(), x = i % px, y = (i - x) / px;
          for (const j of [x > 0 && i - 1, x < px - 1 && i + 1, y > 0 && i - px, y < px - 1 && i + px]) {
            if (j === false || seen[j] || !isF(j) || !gone(j)) continue;
            seen[j] = 1; rim++; stack.push(j);
          }
        }
        row.frame += hf / nf * 100 / n;
        row.text += ht / nt * 100 / n;
        row.rim += (hf ? rim / hf * 100 : 100) / n;
      }
    }
    return out;
  }, { px: PX, levels: LEVELS, stamps: STAMPS, seeds: SEEDS });
} finally {
  await app.close();
}

const f = (v) => v.toFixed(1).padStart(7);
console.log('かすれ  枠の欠け%  字の欠け%  縁から%');
for (const r of rows) console.log(`${String(r.k).padStart(5)}  ${f(r.frame)}   ${f(r.text)}   ${f(r.rim)}`);

// 枠の欠けの増え方: 単調か・一次の当てはまり・10 刻みの増え方のむら
const xs = rows.map((r) => r.k), ys = rows.map((r) => r.frame);
const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
const slope = sxy / sxx;
const ssr = ys.reduce((a, y, i) => a + (y - (my + slope * (xs[i] - mx))) ** 2, 0), sst = ys.reduce((a, y) => a + (y - my) ** 2, 0);
const r2 = sst ? 1 - ssr / sst : 1;
const steps = ys.slice(1).map((y, i) => y - ys[i]);
const monotone = steps.every((d) => d >= -0.3);
const stepRatio = Math.max(...steps) / (steps.reduce((a, b) => a + b) / steps.length || 1);
const at = (k) => rows.find((r) => r.k === k);
const L = LIMITS;
const checks = [
  ['既定（10）の枠の欠け', at(10).frame, `${L.frameAtDefault[0]}〜${L.frameAtDefault[1]}%`, at(10).frame >= L.frameAtDefault[0] && at(10).frame <= L.frameAtDefault[1]],
  ['既定（10）の字の欠け', at(10).text, `≤ ${L.textAtDefault}%`, at(10).text <= L.textAtDefault],
  ['いちばん強い（100）の枠の欠け', at(100).frame, `${L.frameAtMax[0]}〜${L.frameAtMax[1]}%`, at(100).frame >= L.frameAtMax[0] && at(100).frame <= L.frameAtMax[1]],
  ['いちばん強い（100）の字の欠け', at(100).text, `≤ ${L.textAtMax}%`, at(100).text <= L.textAtMax],
  ['枠の欠けの増え方（単調）', monotone ? 1 : 0, '単調', monotone],
  ['枠の欠けの増え方（一次の当てはまり R²）', r2, `≥ ${L.r2}`, r2 >= L.r2],
  ['枠の欠けの増え方（10 刻みの最大 ÷ 平均）', stepRatio, `≤ ${L.stepRatio}`, stepRatio <= L.stepRatio],
  ['欠けは縁から（50）', at(50).rim, `≥ ${L.rim}%`, at(50).rim >= L.rim],
  ['欠けは縁から（100）', at(100).rim, `≥ ${L.rim}%`, at(100).rim >= L.rim],
];
let fail = 0;
for (const [name, v, limit, ok] of checks) {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${v.toFixed(2)}（基準 ${limit}）`);
}
console.log(`${checks.length - fail}/${checks.length} が基準内`);
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify({ rows, checks }, null, 2));
process.exit(fail ? 1 : 0);

// かすれの効き方の評価関数（開発用）: 本物の描き方（app/js/stamp.js）で、かすれ 0〜100 を 10 刻みに描き、インクの減り方を測る。
//
//   node tools/kasure-eval.mjs [--json 出力.json]
//
// 測る物（3 種類の印 × 模様 4 通りの平均。かすれ 0 の印と比べる）:
//   欠け     かすれ 0 でインクのある画素のうち、ほとんど消えた（不透明度 1/8 未満）画素の割合（%）
//   残り     インクの量（不透明度の和）の、かすれ 0 に対する割合（%）
//   ぼかし   インクのある画素のうち、半ば透けた（1/8〜7/8）画素の割合（%）。縁がやわらかいほど増える
// 基準（調整しやすさ）:
//   既定の 10 で欠けは 1% 以下・薄れ（100 − 残り）は 6% 以下（はじめから欠けて見えない）・いちばん強い 100 でも欠けは 30% 以下（字が読める）・
//   薄れは強さに沿って増える（単調・一次の当てはまり R² ≥ 0.95・10 刻みの増え方の最大 ÷ 平均 ≤ 2.5。急に効かない）・
//   かすれを入れたら縁をぼかす（50 でぼかし ≥ かすれ 0 の 1.5 倍）
// 基準を外れた所を FAIL と出し、終了コード 1 を返す。

import fs from 'node:fs';
import { launch, SEED, STATES } from './ui-harness.mjs';

export const LIMITS = { holesAtDefault: 1, lossAtDefault: 6, holesAtMax: 30, r2: 0.95, stepRatio: 2.5, softGain: 1.5 };
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
    const alpha = async (s) => (await window.__ps.drawStamp(s, px)).getContext('2d').getImageData(0, 0, px, px).data;
    const out = levels.map((k) => ({ k, holes: 0, kept: 0, soft: 0 }));
    const n = stamps.length * seeds.length;
    for (const st of stamps) for (const seed of seeds) {
      const base = await alpha({ ...st, kasure: 0, tilt: 0, seed });
      let ink = 0, sum0 = 0;
      for (let i = 3; i < base.length; i += 4) if (base[i] > 127) { ink++; sum0 += base[i]; }
      for (const row of out) {
        const d = await alpha({ ...st, kasure: row.k, tilt: 0, seed });
        let holes = 0, sum = 0, soft = 0, any = 0;
        for (let i = 3; i < d.length; i += 4) {
          if (base[i] > 127) { if (d[i] < 32) holes++; sum += d[i]; }
          if (d[i] > 0) { any++; if (d[i] >= 32 && d[i] <= 223) soft++; }
        }
        row.holes += holes / ink * 100 / n;
        row.kept += sum / sum0 * 100 / n;
        row.soft += soft / Math.max(1, any) * 100 / n;
      }
    }
    return out;
  }, { px: PX, levels: LEVELS, stamps: STAMPS, seeds: SEEDS });
} finally {
  await app.close();
}

const f = (v) => v.toFixed(1).padStart(6);
console.log('かすれ   欠け%   残り%  ぼかし%');
for (const r of rows) console.log(`${String(r.k).padStart(5)} ${f(r.holes)} ${f(r.kept)} ${f(r.soft)}`);

// 薄れの増え方: 単調か・一次の当てはまり・10 刻みの増え方のむら
const xs = rows.map((r) => r.k), ys = rows.map((r) => 100 - r.kept);
const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
const slope = sxy / sxx;
const ssr = ys.reduce((a, y, i) => a + (y - (my + slope * (xs[i] - mx))) ** 2, 0), sst = ys.reduce((a, y) => a + (y - my) ** 2, 0);
const r2 = sst ? 1 - ssr / sst : 1;
const steps = ys.slice(1).map((y, i) => y - ys[i]);
const monotone = steps.every((d) => d >= -0.3);
const stepRatio = Math.max(...steps) / (steps.reduce((a, b) => a + b) / steps.length || 1);
const at = (k) => rows.find((r) => r.k === k);
const checks = [
  ['既定（10）の欠け', at(10).holes, `≤ ${LIMITS.holesAtDefault}%`, at(10).holes <= LIMITS.holesAtDefault],
  ['既定（10）の薄れ', 100 - at(10).kept, `≤ ${LIMITS.lossAtDefault}%`, 100 - at(10).kept <= LIMITS.lossAtDefault],
  ['いちばん強い（100）の欠け', at(100).holes, `≤ ${LIMITS.holesAtMax}%`, at(100).holes <= LIMITS.holesAtMax],
  ['薄れの増え方（単調）', monotone ? 1 : 0, '単調', monotone],
  ['薄れの増え方（一次の当てはまり R²）', r2, `≥ ${LIMITS.r2}`, r2 >= LIMITS.r2],
  ['薄れの増え方（10 刻みの最大 ÷ 平均）', stepRatio, `≤ ${LIMITS.stepRatio}`, stepRatio <= LIMITS.stepRatio],
  ['ぼかし（50 ÷ 0）', at(50).soft / Math.max(0.01, at(0).soft), `≥ ${LIMITS.softGain}`, at(50).soft / Math.max(0.01, at(0).soft) >= LIMITS.softGain],
];
let fail = 0;
for (const [name, v, limit, ok] of checks) {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${v.toFixed(2)}（基準 ${limit}）`);
}
console.log(`${checks.length - fail}/${checks.length} が基準内`);
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify({ rows, checks }, null, 2));
process.exit(fail ? 1 : 0);

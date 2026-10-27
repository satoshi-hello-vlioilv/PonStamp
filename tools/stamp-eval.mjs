// 印影の精度の評価関数（開発用）: 見本（stamp-samples.mjs）を本物の描き方（app/js/stamp.js）で描き、数で測って基準と比べる。
//
//   node tools/stamp-eval.mjs [--json 出力.json] [--font "IPAexMincho"]
//
// 測る物（枠と字を描き分けて、インクで測る）:
//   ゆがみ   字の縦横の伸び縮みの比（1.0 = 字の形のまま）。描くときの記録（trace）から
//   隙間     字のインクから、いちばん近い枠・線のインクまでの距離（印の一辺に対する %）
//   列       列ごとの「ますが占める高さ」の最小 ÷ 最大。短い列が上に寄って下が空く（空きのます）と下がる（1 列だけなら 1）
//   中心     ますの外枠の中心と印の中心の差（%。並べ方の片寄り）と、字のインクの外枠の中心の左右の差（%。1 列・1 行の並べ方だけ。
//            2 列以上では字の幅の違いで動くので見ない）
//   （字のインクの重心は使わない。画数の多い字が重く、並べ方でなく字の性質を測ってしまうため）
// 基準を外れた所を FAIL と出し、終了コード 1 を返す（直したあとに同じ物差しで確かめる）。

import fs from 'node:fs';
import { SAMPLES } from './stamp-samples.mjs';
import { launch, SEED, STATES } from './ui-harness.mjs';

/** 基準（これを外れたら直す）。ゆがみ 1.4 は、和文の組版で長体・平体を 70% までに留める慣習（1/0.7 ≈ 1.43）。根拠は docs/DESIGN.md の「印影の精度」 */
export const LIMITS = { distortion: 1.4, gap: 2.5, columns: 0.97, layout: 1.0, center: 1.0 };

const rest = process.argv.slice(2);
const opt = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : null; };
const PX = 600;

const app = await launch();
let rows;
try {
  const page = await app.newPage({ ...STATES[1], seed: SEED }, { width: 1000, height: 800 });
  rows = await page.evaluate(async ({ samples, px, font }) => {
    const alpha = (cv) => {
      const d = cv.getContext('2d').getImageData(0, 0, px, px).data;
      const a = new Uint8Array(px * px);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] > 127 ? 1 : 0;
      return a;
    };
    // 枠のインクからの距離（2 回なめる近似の距離変換）
    const distance = (mask) => {
      const INF = 1e9;
      const d = new Float32Array(px * px).fill(INF);
      for (let i = 0; i < d.length; i++) if (mask[i]) d[i] = 0;
      const at = (x, y) => (x < 0 || y < 0 || x >= px || y >= px ? INF : d[y * px + x]);
      for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
        const i = y * px + x;
        d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + Math.SQRT2, at(x + 1, y - 1) + Math.SQRT2);
      }
      for (let y = px - 1; y >= 0; y--) for (let x = px - 1; x >= 0; x--) {
        const i = y * px + x;
        d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + Math.SQRT2, at(x - 1, y + 1) + Math.SQRT2);
      }
      return d;
    };
    const out = [];
    for (const s0 of samples) {
      const s = { ...s0, kasure: 0, tilt: 0, ...(font ? { font } : {}) };
      const trace = [];
      await window.__ps.drawStamp(s, px, { trace });
      const frame = alpha(await window.__ps.drawStamp(s, px, { parts: 'frame' }));
      const text = alpha(await window.__ps.drawStamp(s, px, { parts: 'text' }));
      const dist = distance(frame);
      let gap = Infinity, x0 = px, x1 = 0;
      for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
        const i = y * px + x;
        if (!text[i]) continue;
        gap = Math.min(gap, dist[i]);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      }
      const c = px / 2;
      const pct = (v) => Math.round((v / px) * 1000) / 10;
      // ます（描く単位は 1000）。日付印は 1 行ずつが帯に収まる形なので、埋まりと片寄りは見ない
      const boxes = trace.map((t) => t.box);
      const ux0 = Math.min(...boxes.map((b) => b[0])), uy0 = Math.min(...boxes.map((b) => b[1]));
      const ux1 = Math.max(...boxes.map((b) => b[2])), uy1 = Math.max(...boxes.map((b) => b[3]));
      const cols = new Map();
      for (const b of boxes) {
        const k = Math.round((b[0] + b[2]) / 2);
        const [y0, y1] = cols.get(k) || [Infinity, -Infinity];
        cols.set(k, [Math.min(y0, b[1]), Math.max(y1, b[3])]);
      }
      const spans = [...cols.values()].map(([y0, y1]) => y1 - y0);
      const columns = s.type === 'date' ? 1 : Math.min(...spans) / Math.max(...spans);
      const layout = s.type === 'date' ? 0 : Math.hypot((ux0 + ux1) / 2, (uy0 + uy1) / 2) / 10;
      const distortion = Math.max(...trace.map((t) => Math.max(t.sx / t.sy, t.sy / t.sx)));
      const worst = trace.reduce((a, t) => (Math.max(t.sx / t.sy, t.sy / t.sx) > Math.max(a.sx / a.sy, a.sy / a.sx) ? t : a), trace[0]);
      out.push({
        sample: `${s.type} ${s.name || s.square || ''}${s.dept ? ` / ${s.dept}` : ''}`,
        type: s.type,
        distortion: Math.round(distortion * 100) / 100,
        worst: worst ? `${worst.ch}（横 ${worst.sx.toFixed(2)}・縦 ${worst.sy.toFixed(2)}）` : '',
        gap: pct(gap === Infinity ? 0 : gap),
        columns: Math.round(columns * 100) / 100,
        layout: Math.round(layout * 10) / 10,
        center: cols.size > 1 ? 0 : pct(Math.abs((x0 + x1) / 2 - c)),
      });
    }
    return out;
  }, { samples: SAMPLES, px: PX, font: opt('font') });
} finally {
  await app.close();
}

const judge = (r) => [
  r.distortion > LIMITS.distortion && `ゆがみ ${r.distortion}（${r.worst}）> ${LIMITS.distortion}`,
  r.gap < LIMITS.gap && `隙間 ${r.gap}% < ${LIMITS.gap}%`,
  r.columns < LIMITS.columns && `列の高さのそろい ${r.columns} < ${LIMITS.columns}`,
  r.layout > LIMITS.layout && `ますの片寄り ${r.layout}% > ${LIMITS.layout}%`,
  r.center > LIMITS.center && `字の左右のずれ ${r.center}% > ${LIMITS.center}%`,
].filter(Boolean);
let bad = 0;
console.log(`基準: ゆがみ ≤ ${LIMITS.distortion}・隙間 ≥ ${LIMITS.gap}%・列の高さのそろい ≥ ${LIMITS.columns}・ますの片寄り ≤ ${LIMITS.layout}%・字の左右のずれ ≤ ${LIMITS.center}%`);
for (const r of rows) {
  const why = judge(r);
  bad += why.length ? 1 : 0;
  console.log(`${why.length ? 'FAIL' : 'PASS'}  ${r.sample.padEnd(28)} ゆがみ ${String(r.distortion).padEnd(5)} 隙間 ${String(r.gap).padEnd(4)}% 列 ${String(r.columns).padEnd(4)} 片寄り ${String(r.layout).padEnd(3)}% 左右 ${r.center}%${why.length ? `  ← ${why.join('・')}` : ''}`);
}
console.log(`${rows.length - bad}/${rows.length} が基準内`);
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify({ limits: LIMITS, rows }, null, 1));
process.exit(bad ? 1 : 0);

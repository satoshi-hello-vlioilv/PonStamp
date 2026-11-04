// 印の字の大きさの上限の評価関数（開発用）: 見本（stamp-samples.mjs）を本物の描き方（app/js/stamp.js）で、字の大きさ 100〜200% を
// 5 刻みに描き、字が枠からどれだけはみ出すかを測る。種類ごとの上限（TEXT_SIZE.max）がこの物差しで決めた所にあるかを確かめる。
//
//   node tools/textsize-eval.mjs [--json 出力.json]
//
// 測る物（枠と字を描き分けて、インクで測る。印の一辺に対する %）:
//   重なり   字のインクのうち、枠・線のインクに重なる画素の割合（%）。字が枠に食い込み始めると増える
//   字の重なり 字の箱（描くときの記録 trace）どうしが重なる組の数。字が隣の字に食い込むと 1 以上
//   はみ出し 印の外形（認印・日付印は枠の円の外側・角印は枠の四角の外側）より外にある字のインクの、外形からのいちばん遠い距離（%）
// 決まり（利用者が決めた: 「文字自体の大きさは少しはみ出る程度まで」。2026-11-04）:
//   上限は、どの見本でも 字が重ならず・はみ出し ≤ 枠の太さの半分（既定の枠 4% → 2%）で、字が画像の端で切れない、いちばん大きい字の大きさ（5 刻み）。
//   字は枠の線に重なってよいが、印の外形の外へは枠の線の太さの半分までしか出ない（外形が保たれ、印に見える）。
// 上限（TEXT_SIZE.max）がこの決まりで出した値と違えば FAIL と出し、終了コード 1 を返す。

import fs from 'node:fs';
import { SAMPLES } from './stamp-samples.mjs';
import { launch, SEED, STATES } from './ui-harness.mjs';

const rest = process.argv.slice(2);
const opt = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : null; };
const PX = 400;
const SIZES = Array.from({ length: 21 }, (_, i) => 100 + i * 5);

const app = await launch();
let res;
try {
  const page = await app.newPage({ ...STATES[1], seed: SEED }, { width: 1000, height: 800 });
  res = await page.evaluate(async ({ samples, px, sizes }) => {
    const { TEXT_SIZE, ADV_DEFAULTS } = await import('/js/stamp.js');
    const keep = { ...TEXT_SIZE.max };
    // 測る間だけ上限を外す（描き方は上限で字を止めるため）
    for (const k of Object.keys(TEXT_SIZE.max)) TEXT_SIZE.max[k] = 1000;
    const alpha = (cv) => {
      const d = cv.getContext('2d').getImageData(0, 0, px, px).data;
      const a = new Uint8Array(px * px);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] > 127 ? 1 : 0;
      return a;
    };
    const outer = 0.494 * px;   // 外形（描く単位 1000 の 494 = 枠の外側の縁）
    const rows = [];
    try {
      for (const s0 of samples) {
        const row = { sample: `${s0.type} ${s0.name || s0.square || ''}${s0.dept ? ` / ${s0.dept}` : ''}`, type: s0.type, at: [] };
        for (const textSize of sizes) {
          const s = { ...s0, kasure: 0, tilt: 0, textSize, border: ADV_DEFAULTS.border };
          const trace = [];
          await window.__ps.drawStamp(s, px, { trace });
          const b = trace.map((r) => r.box);
          let clash = 0;
          for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
            if (Math.min(b[i][2], b[j][2]) - Math.max(b[i][0], b[j][0]) > 0.5 && Math.min(b[i][3], b[j][3]) - Math.max(b[i][1], b[j][1]) > 0.5) clash++;
          }
          const frame = alpha(await window.__ps.drawStamp(s, px, { parts: 'frame' }));
          const text = alpha(await window.__ps.drawStamp(s, px, { parts: 'text' }));
          let ink = 0, over = 0, out = 0, cut = false;
          for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
            const i = y * px + x;
            if (!text[i]) continue;
            ink++;
            if (frame[i]) over++;
            if (x === 0 || y === 0 || x === px - 1 || y === px - 1) cut = true;
            const dx = Math.abs(x + 0.5 - px / 2), dy = Math.abs(y + 0.5 - px / 2);
            const r = s.type === 'square' ? Math.max(dx, dy) : Math.hypot(dx, dy);
            out = Math.max(out, r - outer);
          }
          row.at.push({ textSize, overlap: Math.round(over / Math.max(1, ink) * 1000) / 10, outside: Math.round(Math.max(0, out) / px * 1000) / 10, cut, clash });
        }
        rows.push(row);
      }
    } finally {
      Object.assign(TEXT_SIZE.max, keep);
    }
    return { rows, max: keep, border: ADV_DEFAULTS.border };
  }, { samples: SAMPLES, px: PX, sizes: SIZES });
} finally {
  await app.close();
}

const allow = res.border / 2;
console.log(`決まり: はみ出し ≤ ${allow}%（既定の枠の太さ ${res.border}% の半分）の、いちばん大きい字の大きさ`);
console.log(`${'見本'.padEnd(30)} ${SIZES.filter((v) => v % 10 === 0).map((v) => String(v).padStart(9)).join('')}  （重なり%/はみ出し%。! は画像の端で切れる・× は字どうしが重なる）`);
for (const r of res.rows) {
  console.log(`${r.sample.padEnd(30)} ${r.at.filter((a) => a.textSize % 10 === 0).map((a) => `${a.overlap.toFixed(0)}/${a.outside.toFixed(1)}${a.cut ? "!" : ""}${a.clash ? "×" : ""}`.padStart(9)).join('')}`);
}
let bad = 0;
const found = {};
for (const type of Object.keys(res.max)) {
  const rows = res.rows.filter((r) => r.type === type);
  let best = 100;
  for (const v of SIZES) if (rows.every((r) => r.at.find((a) => a.textSize === v).outside <= allow && !r.at.find((a) => a.textSize === v).cut && !r.at.find((a) => a.textSize === v).clash)) best = v; else break;
  found[type] = best;
  const ok = res.max[type] === best;
  bad += ok ? 0 : 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${type.padEnd(7)} 決まりで出した上限 ${best}%・TEXT_SIZE.max ${res.max[type]}%`);
}
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify({ allow, found, ...res }, null, 1));
process.exit(bad ? 1 : 0);

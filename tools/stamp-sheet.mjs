// 印影の見本帳（開発用）: いろいろな名前・文字数・種類を本物の描き方（app/js）で描き、1 枚に並べて撮る。
//
//   node tools/stamp-sheet.mjs 出力.png [--kasure 0] [--px 240]
//
// 描き方を直すときに、直す前と後を同じ見本で見比べる。数で測るのは stamp-eval.mjs。

import path from 'node:path';
import { SAMPLES } from './stamp-samples.mjs';
import { launch, SEED, STATES } from './ui-harness.mjs';


const [outArg, ...rest] = process.argv.slice(2);
const opt = (n, d) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? Number(rest[i + 1]) : d; };
const OUT = path.resolve(outArg || 'stamp-sheet.png');
const PX = opt('px', 240);
const KASURE = opt('kasure', 0);

const app = await launch();
try {
  const page = await app.newPage({ ...STATES[1], seed: SEED }, { width: 1200, height: 900 });
  const dataUrl = await page.evaluate(async ({ samples, px, kasure }) => {
    const cols = 4;
    const rows = Math.ceil(samples.length / cols);
    const cv = Object.assign(document.createElement('canvas'), { width: cols * (px + 20) + 20, height: rows * (px + 46) + 20 });
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    for (const [i, s] of samples.entries()) {
      const x = 20 + (i % cols) * (px + 20);
      const y = 20 + Math.floor(i / cols) * (px + 46);
      const one = await window.__ps.drawStamp({ ...s, kasure, tilt: 0 }, px);
      g.strokeStyle = '#e3e6ea';
      g.strokeRect(x - 0.5, y - 0.5, px + 1, px + 1);
      g.drawImage(one, x, y);
      g.fillStyle = '#333';
      g.font = '13px sans-serif';
      g.fillText(`${s.type} ${s.name || s.square || ''} ${s.dept || ''}`, x, y + px + 18);
    }
    return cv.toDataURL('image/png');
  }, { samples: SAMPLES, px: PX, kasure: KASURE });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(OUT);
} finally {
  await app.close();
}

// 評価関数: 貼り付けの大きさを確かめる「ものさし」（app/js/ruler.js）が、解像度ごとに正しい画素の数と目盛りの間隔で描けるか。
//
//   node tools/ruler-eval.mjs
//
// 本物の Chromium で描き、画素を読んで測る:
//   - 幅の画素 = 50mm ÷ 25.4 × dpi（四捨五入）。PNG に書く解像度（Rust の pngx::with_dpi）と合わせて、貼り付け先で 50mm になる
//   - 目盛り（1mm ごと 49 本）の位置の誤差を画素で測る: いちばん大きい誤差 ≤ 半画素（どの線も、いちばん近い画素に置けている）・平均 ≤ 0.3 画素。
//     mm で決めないのは、画素に寄せる時点で誤差が 0〜半画素に散り、平均が約 1/4 画素になるため（300 dpi の 1 画素 = 0.085mm → 平均 ≈ 0.021mm は避けられない）
//   - 幅の誤差（画素に寄せた分）: ≤ 半画素
//   - 地が白く不透明（貼り付け先の地に紛れない）
// 終了コード 0 = 合格。

import { launch } from './ui-harness.mjs';

const DPIS = [300, 600, 1200];
const app = await launch();
let ok = true;
try {
  const page = await app.browser.newPage();
  await page.goto(app.base);
  const rows = await page.evaluate(async (dpis) => {
    const { drawRuler, rulerPx, RULER_MM } = await import('./js/ruler.js');
    return dpis.map((dpi) => {
      const cv = drawRuler(document.createElement('canvas'), dpi);
      const c = cv.getContext('2d');
      const k = cv.width / RULER_MM;
      // 目盛りを読む行: 1mm の線（長さ 3mm）の真ん中の高さ。枠の線より下
      const y = Math.round(1.5 * k);
      const row = c.getImageData(0, y, cv.width, 1).data;
      const dark = (x) => row[x * 4] < 128;
      const runs = [];
      for (let x = 0; x < cv.width; x++) {
        if (dark(x) && (x === 0 || !dark(x - 1))) runs.push([x, x]);
        if (dark(x)) runs[runs.length - 1][1] = x;
      }
      // 両端の枠を除いた線の中心（画素の中心で数える）→ mm
      const inner = runs.slice(1, -1).map(([a, b]) => ((a + b + 1) / 2) / cv.width * RULER_MM);
      const pxPerMm = cv.width / RULER_MM;
      const errs = inner.map((mm, i) => Math.abs(mm - (i + 1)) * pxPerMm);   // 画素
      const all = c.getImageData(0, 0, cv.width, cv.height).data;
      let opaque = true;
      for (let i = 3; i < all.length; i += 4 * 101) if (all[i] !== 255) { opaque = false; break; }
      return {
        dpi, width: cv.width, want: rulerPx(dpi), ticks: inner.length, widthErrPx: Math.abs(cv.width - RULER_MM / 25.4 * dpi), pxMm: 25.4 / dpi,
        meanErr: errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length), maxErr: Math.max(...errs), opaque,
      };
    });
  }, DPIS);
  for (const r of rows) {
    const pass = r.width === r.want && r.widthErrPx <= 0.5 && r.ticks === 49 && r.meanErr <= 0.3 && r.maxErr <= 0.5 + 1e-9 && r.opaque;
    ok &&= pass;
    const mm = (px) => (px * r.pxMm).toFixed(3);
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${r.dpi} dpi  幅 ${r.width}px（${r.want}px・誤差 ${mm(r.widthErrPx)}mm）・目盛り ${r.ticks} 本・`
      + `位置の誤差 平均 ${r.meanErr.toFixed(2)}px（${mm(r.meanErr)}mm）／最大 ${r.maxErr.toFixed(2)}px（${mm(r.maxErr)}mm）・不透明 ${r.opaque}`);
  }
} finally {
  await app.close();
}
console.log(ok ? 'ものさし: OK' : 'ものさし: FAILED');
process.exit(ok ? 0 : 1);

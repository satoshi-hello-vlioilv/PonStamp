// 貼り付けの大きさを確かめる「ものさし」の絵（試しの PNG）。印と同じ道（コピー・PNG 保存）を通し、Office に貼った幅が MM になるかを見る。
//
// - 幅 MM（50mm）・高さ HEIGHT（16mm）を、解像度 dpi の画素で描く（画素の数 = mm ÷ 25.4 × dpi。印の exportPx と同じ式）
// - 1mm ごとの短い線・5mm の中くらいの線・10mm の長い線と数（cm）。枠の幅がちょうど MM
// - 地は白（透明だと貼り付け先の地に紛れて端が見えない）
// 精度は tools/ruler-eval.mjs が確かめる（画素の数・目盛りの間隔）。

export const RULER_MM = 50;
const HEIGHT = 16;

/** mm → いまの解像度の画素 */
export const rulerPx = (dpi, mm = RULER_MM) => Math.round(mm / 25.4 * dpi);

/** cv に、解像度 dpi のものさしを描く → cv */
export function drawRuler(cv, dpi) {
  const w = rulerPx(dpi);
  const k = w / RULER_MM;                    // 1mm の画素
  cv.width = w;
  cv.height = rulerPx(dpi, HEIGHT);
  const c = cv.getContext('2d');
  const line = Math.max(1, Math.round(k * 0.15));
  c.fillStyle = '#fff';
  c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#111';
  // 枠（外の縁がちょうど 0〜MM。線は内側に引く）
  c.fillRect(0, 0, w, line); c.fillRect(0, cv.height - line, w, line);
  c.fillRect(0, 0, line, cv.height); c.fillRect(w - line, 0, line, cv.height);
  // 目盛り: i mm の線の中心を i × k に置く（両端は枠の内側に寄せる）
  for (let i = 1; i < RULER_MM; i++) {
    const len = (i % 10 === 0 ? 7 : i % 5 === 0 ? 5 : 3) * k;
    const x = Math.round(i * k - line / 2);
    c.fillRect(x, 0, line, Math.round(len));
  }
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.font = `${(3.2 * k).toFixed(1)}px "Yu Gothic UI", "Meiryo UI", sans-serif`;
  for (let cm = 1; cm < RULER_MM / 10; cm++) c.fillText(String(cm), cm * 10 * k, 10.6 * k);
  c.font = `bold ${(2.6 * k).toFixed(1)}px "Yu Gothic UI", "Meiryo UI", sans-serif`;
  c.fillText(`枠の幅 ${RULER_MM} mm`, w / 2, 14.4 * k);
  return cv;
}

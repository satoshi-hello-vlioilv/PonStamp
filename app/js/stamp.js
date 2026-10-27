// 印影を描く（画面にも窓にも依らない部品。描くのは canvas だけ）。画面（app.js）・自己診断・評価関数（tools/stamp-eval.mjs）が使う。

/* ================================================================ 定義 */
export const TYPES = {
  mitome: { label: '認印',   sizes: [9, 10.5, 12, 13.5, 15] },
  date:   { label: '日付印', sizes: [12, 15, 18, 21] },
  square: { label: '角印',   sizes: [15, 18, 21, 24, 30] },
};
export const COLORS = [
  { name: '朱色', v: '#d6343a' }, { name: '赤', v: '#e60012' }, { name: 'えんじ', v: '#9e1f2b' },
  { name: '藍', v: '#1f3a93' }, { name: '黒', v: '#222222' },
];
export const FONT_CANDIDATES = [
  ['HG正楷書体-PRO', '正楷書体（印鑑風）'],
  ['HG行書体', '行書体'],
  ['HG教科書体', '教科書体'],
  ['HG明朝E', '明朝 極太'],
  ['HG明朝B', '明朝 太'],
  ['Yu Mincho', '游明朝'],
  ['MS Mincho', 'MS 明朝'],
  ['BIZ UDMincho', 'BIZ UD明朝'],
  ['Yu Gothic', '游ゴシック'],
  ['Meiryo', 'メイリオ'],
  ['HG丸ｺﾞｼｯｸM-PRO', '丸ゴシック'],
];
const FALLBACK = '"Yu Mincho","MS Mincho",serif';
const FS = 200;          // 描画用の基準フォントサイズ（論理単位）
const REF = '国';        // 文字枠合わせの基準字
// 字の縦横の伸び縮みの上限（長体・平体）。和文の組版で長体・平体を 70% までに留める慣習（1/0.7 ≈ 1.43）に合わせる。
// これを超えて枠に合わせると、字が棒のように潰れたり引き伸ばされたりする（tools/stamp-eval.mjs が測る）
export const MAX_DISTORT = 1.4;
export const ADV_DEFAULTS = { border: 4, bold: 2, kasure: 10, tilt: 0 };
export const DEFAULTS = {
  type: 'mitome', name: '山田', dept: '総務課', dateAuto: true, date: '', dateFmt: 'y2', pad: false,
  square: '株式会社見本之印', sqCols: 'auto', color: '#d6343a', font: '',
  ...ADV_DEFAULTS, seed: 1, dpi: 600, bg: 'checker',
  size: { mitome: 10.5, date: 15, square: 21 },
};


export function clone(o) { return JSON.parse(JSON.stringify(o)); }
export function merge(base, add) {
  const o = clone(base);
  if (add && typeof add === 'object') {
    for (const k of Object.keys(base)) {
      if (!(k in add)) continue;
      if (k === 'size') { o.size = { ...base.size, ...(add.size || {}) }; }
      else if (typeof add[k] === typeof base[k]) { o[k] = add[k]; }
    }
  }
  if (!TYPES[o.type]) o.type = 'mitome';
  return o;
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ================================================================ 文字列 */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function stampDate(s) {
  let d = new Date();
  if (!s.dateAuto && /^\d{4}-\d{2}-\d{2}$/.test(s.date)) {
    const [y, m, dd] = s.date.split('-').map(Number);
    d = new Date(y, m - 1, dd);
  }
  return d;
}
export function dateText(s) {
  const d = stampDate(s);
  const y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
  const p = v => (s.pad ? String(v).padStart(2, '0') : String(v));
  switch (s.dateFmt) {
    case 'y4': return `${y}.${p(m)}.${p(dd)}`;
    case 'r':  return `R${y - 2018}.${p(m)}.${p(dd)}`;
    case 'rn': return `${y - 2018}.${p(m)}.${p(dd)}`;
    default:   return `’${String(y % 100).padStart(2, '0')}.${p(m)}.${p(dd)}`;
  }
}
const chars = str => [...String(str || '').replace(/\s/g, '')];

/* ================================================================ 描画 */
function fontStack(f) { return f ? `"${f}", ${FALLBACK}` : FALLBACK; }

// 描く物の選び（評価関数が枠と字を分けて測る）と、字ごとの伸び縮みの記録。render の間だけ効く
let job = { frame: true, text: true, trace: null };
const note = (ch, sx, sy, cx, cy, w, h) => job.trace && job.trace.push({ ch, sx, sy, box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] });

// 1文字を枠(w×h)に合わせて描画。基準字「国」で拡大率を決め、縦長の印鑑らしい字形に
function glyph(ctx, ch, cx, cy, w, h, s) {
  if (!ch || !job.text) return;
  ctx.save();
  ctx.font = `${FS}px ${fontStack(s.font)}`;
  const sw = s.bold * FS / 100;
  const r = ctx.measureText(REF);
  const rw = r.actualBoundingBoxLeft + r.actualBoundingBoxRight + sw;
  const rh = r.actualBoundingBoxAscent + r.actualBoundingBoxDescent + sw;
  let sx = w / rw, sy = h / rh;
  if (sy > sx * MAX_DISTORT) sy = sx * MAX_DISTORT;
  if (sx > sy * MAX_DISTORT) sx = sy * MAX_DISTORT;
  note(ch, sx, sy, cx, cy, w, h);
  const m = ctx.measureText(ch);
  const x = (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
  const y = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.translate(cx, cy);
  ctx.scale(sx, sy);
  ctx.fillText(ch, x, y);
  if (sw > 0) { ctx.lineWidth = sw; ctx.lineJoin = 'round'; ctx.strokeText(ch, x, y); }
  ctx.restore();
}

// 横書き 1 行を枠(w×h)に合わせて描画。字の高さは基準字「国」で決める（平たい「一」などを縦に引き伸ばさない）。
// 横には伸ばさず、長い行は MAX_DISTORT まで横に詰め、それでも入らなければ字を小さくする
function line(ctx, str, cx, cy, w, h, s) {
  if (!str || !job.text) return;
  ctx.save();
  ctx.font = `${FS}px ${fontStack(s.font)}`;
  const sw = s.bold * FS / 100;
  const m = ctx.measureText(str);
  const r = ctx.measureText(REF);
  const gw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight + sw;
  const rh = r.actualBoundingBoxAscent + r.actualBoundingBoxDescent + sw;
  let sy = h / rh;
  let sx = Math.min(w / gw, sy);
  if (sy > sx * MAX_DISTORT) sy = sx * MAX_DISTORT;
  note(str, sx, sy, cx, cy, w, h);
  const x = (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
  const y = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.translate(cx, cy);
  ctx.scale(sx, sy);
  ctx.fillText(str, x, y);
  if (sw > 0) { ctx.lineWidth = sw; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.restore();
}

// n 字を cols 列に分けたときの列ごとの字の数（右の列から埋める。最後の列が短い）
function columnCounts(n, cols) {
  const rows = Math.ceil(n / cols);
  return Array.from({ length: cols }, (_, c) => Math.max(0, Math.min(rows, n - c * rows))).filter(Boolean);
}

// 字を W×H の箱へ、右の列から上→下に並べる。短い列も列の高さいっぱいに割り付ける（下に空きのますを作らない）
function columnsOf(ctx, cs, counts, W, H, inset, s) {
  let i = 0;
  counts.forEach((cnt, col) => {
    const cw = W / counts.length, chh = H / cnt;
    const x = W / 2 - (col + 0.5) * cw;
    for (let row = 0; row < cnt; row++, i++) glyph(ctx, cs[i], x, -H / 2 + (row + 0.5) * chh, cw * inset, chh * inset, s);
  });
}

// 角印の列数（自動）: ゆがみの上限の中で、字が最も大きく描ける並べ方（字の面積 ÷ 箱の面積が最大）。同じなら列の多い方（縦書きの列）
function bestColumns(n) {
  let best = 1, bestFill = -1;
  for (let cols = 1; cols <= n; cols++) {
    const counts = columnCounts(n, cols);
    if (counts.length !== cols) continue;
    const fill = counts.reduce((a, cnt) => {
      const w = 1 / cols, h = 1 / cnt;        // ますの大きさ（箱を 1 として）。字はおよそ正方形
      return a + cnt * Math.min(w, h * MAX_DISTORT) * Math.min(h, w * MAX_DISTORT);
    }, 0);
    if (fill >= bestFill - 1e-9) { best = cols; bestFill = fill; }
  }
  return best;
}

function circle(ctx, r, lw) {
  if (!job.frame) return;
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
}

function drawMitome(ctx, s, lw) {
  const R = 500 - lw / 2 - 6;
  circle(ctx, R, lw);
  const ri = R - lw / 2 - R * 0.07;
  const cs = chars(s.name);
  const n = cs.length;
  if (!n) return;
  if (n <= 3) {
    const H = ri * 2 * (n === 1 ? 0.66 : n === 2 ? 0.86 : 0.9);
    const ch = H / n;
    cs.forEach((c, i) => {
      const top = -H / 2 + i * ch, bot = top + ch;
      const ye = Math.max(Math.abs(top), Math.abs(bot));
      const half = Math.sqrt(Math.max(ri * ri - ye * ye, 0));
      const w = Math.min(2 * half * 0.95, ch * 1.6);
      glyph(ctx, c, 0, (top + bot) / 2, w, ch * 0.93, s);
    });
  } else {
    // 4 字以上は 2 列（右の列が姓・左の列が名の形）。円に内接する縦長の箱に並べる
    const counts = columnCounts(n, 2), rows = counts[0];
    const aspect = rows / 2 * 1.15;
    const W = (2 * ri * 0.98) / Math.sqrt(1 + aspect * aspect), H = W * aspect;
    columnsOf(ctx, cs, counts, W, H, 0.94, s);
  }
}

function drawDate(ctx, s, lw) {
  const R = 500 - lw / 2 - 6;
  circle(ctx, R, lw);
  const ri = R - lw / 2;
  const yl = R * 0.3, tl = lw * 0.75;
  const hl = Math.sqrt(R * R - yl * yl);
  if (job.frame) {
    ctx.lineWidth = tl;
    ctx.beginPath();
    ctx.moveTo(-hl, -yl); ctx.lineTo(hl, -yl);
    ctx.moveTo(-hl, yl); ctx.lineTo(hl, yl);
    ctx.stroke();
  }
  // 中段：日付
  const midH = (yl * 2 - tl) * 0.58;
  const midW = 2 * Math.sqrt(ri * ri - yl * yl) * 0.86;
  line(ctx, dateText(s), 0, 0, midW, midH, s);
  // 上段・下段
  const regionH = ri - yl - tl / 2;
  const th = regionH * 0.5;
  const cy = yl + tl / 2 + regionH * 0.12 + th / 2;
  const yFar = cy + th / 2;
  const w = 2 * Math.sqrt(Math.max(ri * ri - yFar * yFar, 0)) * 0.9;
  line(ctx, String(s.dept || '').trim(), 0, -cy, w, th, s);
  line(ctx, String(s.name || '').trim(), 0, cy, w, th, s);
}

function drawSquare(ctx, s, lw) {
  const half = 500 - lw / 2 - 6;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'miter';
  if (job.frame) ctx.strokeRect(-half, -half, half * 2, half * 2);
  const inner = half - lw / 2 - 35;
  const cs = chars(s.square);
  const n = cs.length;
  if (!n) return;
  const cols = s.sqCols === 'auto' ? bestColumns(n) : clamp(Number(s.sqCols) || 1, 1, n);
  columnsOf(ctx, cs, columnCounts(n, cols), inner * 2, inner * 2, 0.92, s);
}

// 乱数とノイズ（かすれ表現）
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function makeGrid(G, rnd) {
  const a = new Float32Array((G + 1) * (G + 1));
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  return a;
}
function sample(a, G, u, v) {
  const x0 = Math.min(G - 1, Math.floor(u)), y0 = Math.min(G - 1, Math.floor(v));
  const fx = u - x0, fy = v - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const i = y0 * (G + 1) + x0;
  return (a[i] * (1 - sx) + a[i + 1] * sx) * (1 - sy) + (a[i + G + 1] * (1 - sx) + a[i + G + 2] * sx) * sy;
}
function applyKasure(ctx, px, k, seed) {
  const rnd = mulberry32(seed * 9973 + 7);
  const G1 = 40, G2 = 140;
  const g1 = makeGrid(G1, rnd), g2 = makeGrid(G2, rnd);
  const grain = mulberry32(seed + 101);
  const img = ctx.getImageData(0, 0, px, px);
  const d = img.data;
  const t = 0.2 + k * 0.45;
  for (let y = 0; y < px; y++) {
    const v1 = y / px * G1, v2 = y / px * G2;
    for (let x = 0; x < px; x++) {
      const idx = (y * px + x) * 4 + 3;
      if (d[idx] === 0) continue;
      const n = sample(g1, G1, x / px * G1, v1) * 0.6 + sample(g2, G2, x / px * G2, v2) * 0.4;
      let f = (n - t) / 0.08;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      f *= 1 - k * 0.25 * grain();
      d[idx] = d[idx] * f;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * 印影を px 四方の canvas に描く。opts（評価関数用）: parts = 'all' | 'frame'（枠と線だけ）| 'text'（字だけ）、
 * trace = 配列（字ごとの伸び縮み {ch, sx, sy} を足す）
 */
export function render(cv, s, px, { parts = 'all', trace = null } = {}) {
  job = { frame: parts !== 'text', text: parts !== 'frame', trace };
  cv.width = px; cv.height = px;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, px, px);
  ctx.save();
  ctx.scale(px / 1000, px / 1000);
  ctx.translate(500, 500);
  const t = s.tilt * Math.PI / 180;
  ctx.rotate(t);
  if (s.type === 'square') { const k = 1 / (Math.abs(Math.cos(t)) + Math.abs(Math.sin(t))); ctx.scale(k, k); }
  ctx.fillStyle = ctx.strokeStyle = s.color;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const lw = 1000 * s.border / 100;
  if (s.type === 'date') drawDate(ctx, s, lw);
  else if (s.type === 'square') drawSquare(ctx, s, lw);
  else drawMitome(ctx, s, lw);
  ctx.restore();
  job = { frame: true, text: true, trace: null };
  if (s.kasure > 0) applyKasure(ctx, px, s.kasure / 100, s.seed);
  return cv;
}

export const exportPx = s => Math.max(32, Math.round((s.size[s.type] || 12) / 25.4 * s.dpi));

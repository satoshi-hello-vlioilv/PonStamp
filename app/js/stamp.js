// 印影を描く（画面にも窓にも依らない部品。描くのは canvas だけ）。画面（app.js）・自己診断・評価関数（tools/stamp-eval.mjs）が使う。

/* ================================================================ 定義 */
export const TYPES = {
  // sizes: よく使う大きさ（目盛り）・range: スライダーの幅（mm。打ち込めば 5〜60mm）
  // 帯の幅は目盛りの少し外まで（目盛りの無い長い所を作らない。幅の外は打ち込む）
  mitome: { label: '認印',   sizes: [9, 10.5, 12, 13.5, 15], range: [7.5, 16.5] },
  date:   { label: '日付印', sizes: [12, 15, 18, 21],        range: [10.5, 22.5] },
  square: { label: '角印',   sizes: [15, 18, 21, 24, 30],    range: [12, 33] },
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
export const ADV_DEFAULTS = { border: 4, bold: 2, kasure: 10, tilt: 0, textSize: 100 };
/** 字の大きさ（%）。100 = 並べ方が決める標準の大きさ（字と枠の隙間を保つ）。上限は「少しはみ出る程度まで」（利用者が決めた。2026-11-04）:
 * 字どうしは重ならず、字が枠の線に重なってよく、印の外形の外へは枠の太さの半分までしか出ず、画像の端で切れない、いちばん大きい所
 * （tools/textsize-eval.mjs が見本ごとに測って出す。上限を変えたら評価関数も通す） */
export const TEXT_SIZE = { min: 60, max: { mitome: 125, date: 125, square: 115 } };
/**
 * 日付の書式（利用者が決めた: 区切りの形を増やし、自分でも作れるようにする。2026-11-04）。書式は Excel の表示形式と同じ記号で書く
 * （事務で見慣れた型。記号の外の字はそのまま出す。記号の字をそのまま出すときは "" で囲む）:
 *   yyyy 2026・yy 26・e 8（和暦の年）・ee 08・g R・gg 令・ggg 令和・m 11・mm 11（2 桁）・d 4・dd 04・aaa 水・aaaa 水曜日
 * 決まった書式（DATE_PRESETS）は画面が今日の日付の例を付けて並べる。quick はよく使う形（札で並べる。ほかは「ほかの形」の一覧）
 */
export const DATE_PRESETS = [
  { v: "'yy.m.d", quick: true }, { v: 'yy.m.d', quick: true }, { v: 'yy/m/d', quick: true }, { v: 'yyyy/m/d', quick: true },
  { v: 'yyyy/mm/dd', quick: true }, { v: 'ge.m.d', quick: true }, { v: 'ggge年m月d日', quick: true },
  { v: 'yyyy.m.d' }, { v: 'yy/mm/dd' }, { v: 'yyyy-mm-dd' }, { v: 'ge/m/d' }, { v: 'e.m.d' }, { v: 'yyyy年m月d日' }, { v: 'yy年m月d日' },
];
/** 書式の記号（画面の説明が並べる。例は 2026-11-04） */
export const DATE_TOKENS = [
  ['yyyy', '西暦 4 桁'], ['yy', '西暦 2 桁'], ['e', '和暦の年'], ['g', 'R'], ['ggg', '令和'],
  ['m', '月'], ['mm', '月 2 桁'], ['d', '日'], ['dd', '日 2 桁'], ['aaa', '曜日'],
];
/** 元号（始まる日の新しい順）。g・gg・ggg と e はこれで決める */
const ERAS = [
  { from: [2019, 5, 1], g: 'R', gg: '令', ggg: '令和' }, { from: [1989, 1, 8], g: 'H', gg: '平', ggg: '平成' },
  { from: [1926, 12, 25], g: 'S', gg: '昭', ggg: '昭和' },
];
const WEEK = '日月火水木金土';
/** 解像度（dpi）の選択肢（1 か所の定義。設定の画面が並べ、merge がこの外の値を既定に直す。窓の Rust は 72〜4800 だけを受ける） */
export const DPIS = [{ v: 300, note: '軽い' }, { v: 600, note: '標準' }, { v: 1200, note: '高精細' }];
export const DEFAULTS = {
  type: 'mitome', name: '山田', dept: '総務課', dateAuto: true, date: '', dateTpl: "'yy.m.d",
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
  // 1.4 までの日付の形（年の書き方・区切り・2 桁）は書式に直す（登録した印・前に使った設定を引き継ぐ）
  if (add && typeof add === 'object' && typeof add.dateTpl !== 'string' && typeof add.dateFmt === 'string') o.dateTpl = legacyDateTpl(add);
  if (!o.dateTpl.trim()) o.dateTpl = base.dateTpl;
  if (!TYPES[o.type]) o.type = 'mitome';
  // 前の形から引き継いだ覚えなどに選択肢の外の解像度があると、窓が「解像度（dpi）の値が違います」で断る。既定に直す
  if (!DPIS.some(d => d.v === o.dpi)) o.dpi = base.dpi;
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
/** 1.4 までの日付の形（年の書き方 dateFmt・区切り dateSep・2 桁 pad）→ 書式 */
export function legacyDateTpl({ dateFmt, dateSep, pad }) {
  const year = { y4: 'yyyy', y2n: 'yy', r: 'ge', rk: 'ggge', rn: 'e' }[dateFmt] ?? "'yy";
  const m = pad ? 'mm' : 'm', d = pad ? 'dd' : 'd';
  if (dateSep === 'kanji') return `${year}年${m}月${d}日`;
  const sep = ['/', '-'].includes(dateSep) ? dateSep : '.';
  return `${year}${sep}${m}${sep}${d}`;
}
const DATE_TOKEN = /"[^"]*"|yyyy|yy|ggg|gg|g|ee|e|mm|m|dd|d|aaaa|aaa/gi;
/** 日付 d を書式 tpl で書く */
export function formatDate(tpl, d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
  const era = ERAS.find(e => d >= new Date(e.from[0], e.from[1] - 1, e.from[2]));
  const ey = era ? y - era.from[0] + 1 : y;
  const two = v => String(v).padStart(2, '0');
  const put = {
    yyyy: y, yy: two(y % 100), e: ey, ee: two(ey), g: era?.g ?? '', gg: era?.gg ?? '', ggg: era?.ggg ?? '',
    m, mm: two(m), d: dd, dd: two(dd), aaa: WEEK[d.getDay()], aaaa: `${WEEK[d.getDay()]}曜日`,
  };
  return String(tpl).replace(DATE_TOKEN, t => (t.startsWith('"') ? t.slice(1, -1) : String(put[t.toLowerCase()])));
}
export const dateText = s => formatDate(s.dateTpl, stampDate(s));
const chars = str => [...String(str || '').replace(/\s/g, '')];

/* ================================================================ 描画 */
const textScale = s => clamp(Number(s.textSize) || 100, TEXT_SIZE.min, TEXT_SIZE.max[s.type] ?? 100) / 100;
/**
 * 字の箱（中心 cx・cy・幅 w・高さ h）を字の大きさに合わせる。小さくするときは箱をその場で縮める（字の間が空く）。
 * 大きくするときは字の並び全体を印の中心から広げる（箱の位置も同じ倍率で外へ）: 字どうしの間も同じ割合で広がり、字が重ならない
 * （前は箱をその場で広げ、2 字以上で隣の字に食い込んだ。tools/textsize-eval.mjs が字の箱の重なりを測る）
 */
function fitText(s, cx, cy, w, h) {
  const k = textScale(s);
  return k > 1 ? [cx * k, cy * k, w * k, h * k] : [cx, cy, w * k, h * k];
}
function fontStack(f) { return f ? `"${f}", ${FALLBACK}` : FALLBACK; }

// 描く物の選び（評価関数が枠と字を分けて測る）と、字ごとの伸び縮みの記録。render の間だけ効く
let job = { frame: true, text: true, trace: null };
const note = (ch, sx, sy, cx, cy, w, h) => job.trace && job.trace.push({ ch, sx, sy, box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] });

// 1文字を枠(w×h)に合わせて描画。基準字「国」で拡大率を決め、縦長の印鑑らしい字形に
function glyph(ctx, ch, cx, cy, w, h, s) {
  if (!ch || !job.text) return;
  [cx, cy, w, h] = fitText(s, cx, cy, w, h);
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
  [cx, cy, w, h] = fitText(s, cx, cy, w, h);
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
/** 箱でならす（2 回なめる。a は px×px の 0〜1）→ 新しい配列 */
function boxBlur(a, px, r) {
  const b = new Float32Array(a.length), c = new Float32Array(a.length), n = 2 * r + 1;
  const pass = (src, dst, horizontal) => {
    for (let o = 0; o < px; o++) {
      const at = i => src[horizontal ? o * px + Math.min(px - 1, Math.max(0, i)) : Math.min(px - 1, Math.max(0, i)) * px + o];
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += at(i);
      for (let i = 0; i < px; i++) {
        dst[horizontal ? o * px + i : i * px + o] = acc / n;
        acc += at(i + r + 1) - at(i - r);
      }
    }
  };
  pass(a, b, true); pass(b, c, false);
  return c;
}
/**
 * かすれ（利用者が決めた: 字が読めなくならないよう、枠の縁が欠ける形にする。2026-11-04）。
 * 押した印は、紙に強く当たる枠の縁から欠ける。そこで、インクの縁からの近さ（ならしたインクの薄さ）と大きめの模様を足し、
 * 境を越えた所を欠く: 欠けは縁から内へ食い込み、塊になる（点々の穴にしない）。強いほど深く・多く欠ける。
 * 枠と字は分けて描き、字には弱くだけ効かせる（字の縁が少し荒れるだけ。tools/kasure-eval.mjs が字の欠けと枠の欠けを測る）。
 * band: 縁からどこまでを「縁」とみるか（線の太さに対する比）・edge: 縁の近さの効き・from/span/curve: 強さ k に対する境
 * text: 字への効き（枠の何倍か）・fine: 縁を荒らす細かい模様の混ぜ方・soft: 欠けの境の幅（小さいほどくっきり）
 */
export const KASURE = { band: 0.55, edge: 0.8, from: 1.4, span: 0.55, curve: 0.3, text: 0.4, fine: 0.3, coarse: 0.5, soft: 0.03 };
function wear(ctx, px, depth, seed, line) {
  if (depth <= 0) return;
  const img = ctx.getImageData(0, 0, px, px);
  const d = img.data;
  const a = new Float32Array(px * px);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  const near = boxBlur(a, px, Math.max(1, Math.round(line * KASURE.band)));
  const rnd = mulberry32(seed * 9973 + 7);
  const G0 = 5, G1 = 26, G2 = 110;
  const g1 = makeGrid(G1, rnd), g2 = makeGrid(G2, rnd), g0 = makeGrid(G0, rnd);
  const t = KASURE.from - depth;
  for (let y = 0; y < px; y++) {
    const v0 = y / px * G0, v1 = y / px * G1, v2 = y / px * G2;
    for (let x = 0; x < px; x++) {
      const i = y * px + x;
      if (!a[i]) continue;
      const n = sample(g1, G1, x / px * G1, v1) * (1 - KASURE.fine) + sample(g2, G2, x / px * G2, v2) * KASURE.fine;
      const m = (sample(g0, G0, x / px * G0, v0) - 0.5) * KASURE.coarse;
      const v = n + m + KASURE.edge * (1 - near[i]);
      let f = (t - v) / KASURE.soft + 0.5;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      d[i * 4 + 3] *= f;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// 枠と字を（選んだ方だけ）canvas に描く
function paint(cv, s, px, frame, text, trace) {
  job = { frame, text, trace };
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
  return ctx;
}

/**
 * 印影を px 四方の canvas に描く。opts（評価関数用）: parts = 'all' | 'frame'（枠と線だけ）| 'text'（字だけ）、
 * trace = 配列（字ごとの伸び縮み {ch, sx, sy} を足す）
 */
export function render(cv, s, px, { parts = 'all', trace = null } = {}) {
  const frame = parts !== 'text', text = parts !== 'frame', k = s.kasure / 100;
  // 線の太さ（px）: 枠は枠の太さ・字は画の太さのおよそ（印の一辺の 1.2%）
  const lines = { frame: px * s.border / 100, text: px * 0.012 };
  if (!(k > 0)) { paint(cv, s, px, frame, text, trace); return cv; }
  // かすれは枠と字に分けて効かせ、重ねる（字は弱く）
  const ctx = paint(cv, s, px, frame, false, null);
  const depth = KASURE.span * k ** KASURE.curve;
  if (frame) wear(ctx, px, depth, s.seed, lines.frame);
  if (text) {
    const layer = document.createElement('canvas');
    wear(paint(layer, s, px, false, true, trace), px, depth * KASURE.text, s.seed + 1, lines.text);
    ctx.drawImage(layer, 0, 0);
  }
  return cv;
}

export const exportPx = s => Math.max(32, Math.round((s.size[s.type] || 12) / 25.4 * s.dpi));

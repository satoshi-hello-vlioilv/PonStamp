(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ================================================================ 定義 */
const TYPES = {
  mitome: { label: '認印',   sizes: [9, 10.5, 12, 13.5, 15] },
  date:   { label: '日付印', sizes: [12, 15, 18, 21] },
  square: { label: '角印',   sizes: [15, 18, 21, 24, 30] },
};
const COLORS = [
  { name: '朱色', v: '#d6343a' }, { name: '赤', v: '#e60012' }, { name: 'えんじ', v: '#9e1f2b' },
  { name: '藍', v: '#1f3a93' }, { name: '黒', v: '#222222' },
];
const FONT_CANDIDATES = [
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
const ADV_DEFAULTS = { border: 4, bold: 2, kasure: 10, tilt: 0 };
const DEFAULTS = {
  type: 'mitome', name: '山田', dept: '総務課', dateAuto: true, date: '', dateFmt: 'y2', pad: false,
  square: '株式会社見本之印', sqCols: 'auto', color: '#d6343a', font: '',
  ...ADV_DEFAULTS, seed: 1, dpi: 600, bg: 'checker',
  size: { mitome: 10.5, date: 15, square: 21 },
};

let S = clone(DEFAULTS);
let presets = [];
let fonts = [];

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function merge(base, add) {
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
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ================================================================ 文字列 */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function stampDate(s) {
  let d = new Date();
  if (!s.dateAuto && /^\d{4}-\d{2}-\d{2}$/.test(s.date)) {
    const [y, m, dd] = s.date.split('-').map(Number);
    d = new Date(y, m - 1, dd);
  }
  return d;
}
function dateText(s) {
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

// 1文字を枠(w×h)に合わせて描画。基準字「国」で拡大率を決め、縦長の印鑑らしい字形に
function glyph(ctx, ch, cx, cy, w, h, s) {
  if (!ch) return;
  ctx.save();
  ctx.font = `${FS}px ${fontStack(s.font)}`;
  const sw = s.bold * FS / 100;
  const r = ctx.measureText(REF);
  const rw = r.actualBoundingBoxLeft + r.actualBoundingBoxRight + sw;
  const rh = r.actualBoundingBoxAscent + r.actualBoundingBoxDescent + sw;
  let sx = w / rw, sy = h / rh;
  if (sy > sx * 2.4) sy = sx * 2.4;
  if (sx > sy * 1.8) sx = sy * 1.8;
  const m = ctx.measureText(ch);
  const x = (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
  const y = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.translate(cx, cy);
  ctx.scale(sx, sy);
  ctx.fillText(ch, x, y);
  if (sw > 0) { ctx.lineWidth = sw; ctx.lineJoin = 'round'; ctx.strokeText(ch, x, y); }
  ctx.restore();
}

// 横書き1行を枠(w×h)に合わせて描画（長い文字列は横方向に詰める）
function line(ctx, str, cx, cy, w, h, s) {
  if (!str) return;
  ctx.save();
  ctx.font = `${FS}px ${fontStack(s.font)}`;
  const sw = s.bold * FS / 100;
  const m = ctx.measureText(str);
  const gw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight + sw;
  const gh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + sw;
  let sx = w / gw, sy = h / gh;
  if (sx > sy * 1.25) sx = sy * 1.25;
  if (sy > sx * 1.8) sy = sx * 1.8;
  const x = (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
  const y = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.translate(cx, cy);
  ctx.scale(sx, sy);
  ctx.fillText(str, x, y);
  if (sw > 0) { ctx.lineWidth = sw; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.restore();
}

function circle(ctx, r, lw) {
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
    const cols = 2, rows = Math.ceil(n / cols);
    const aspect = rows / cols * 1.15;
    const W = (2 * ri * 0.98) / Math.sqrt(1 + aspect * aspect), H = W * aspect;
    cs.forEach((c, i) => {
      const col = Math.floor(i / rows), row = i % rows;
      const cnt = Math.min(rows, n - col * rows);   // 短い列は上下中央に寄せる
      const x = W / 2 - (col + 0.5) * W / cols;
      const y = -H / 2 + (row + (rows - cnt) / 2 + 0.5) * H / rows;
      glyph(ctx, c, x, y, W / cols * 0.94, H / rows * 0.94, s);
    });
  }
}

function drawDate(ctx, s, lw) {
  const R = 500 - lw / 2 - 6;
  circle(ctx, R, lw);
  const ri = R - lw / 2;
  const yl = R * 0.3, tl = lw * 0.75;
  const hl = Math.sqrt(R * R - yl * yl);
  ctx.lineWidth = tl;
  ctx.beginPath();
  ctx.moveTo(-hl, -yl); ctx.lineTo(hl, -yl);
  ctx.moveTo(-hl, yl); ctx.lineTo(hl, yl);
  ctx.stroke();
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
  ctx.strokeRect(-half, -half, half * 2, half * 2);
  const inner = half - lw / 2 - 35;
  const cs = chars(s.square);
  const n = cs.length;
  if (!n) return;
  const cols = s.sqCols === 'auto' ? Math.ceil(Math.sqrt(n)) : clamp(Number(s.sqCols) || 1, 1, n);
  const rows = Math.ceil(n / cols);
  const cw = inner * 2 / cols, chh = inner * 2 / rows;
  cs.forEach((c, i) => {
    const col = Math.floor(i / rows), row = i % rows;
    glyph(ctx, c, inner - (col + 0.5) * cw, -inner + (row + 0.5) * chh, cw * 0.92, chh * 0.92, s);
  });
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

function render(cv, s, px) {
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
  if (s.kasure > 0) applyKasure(ctx, px, s.kasure / 100, s.seed);
  return cv;
}

const exportPx = s => Math.max(32, Math.round((s.size[s.type] || 12) / 25.4 * s.dpi));
const exportCanvas = () => render(document.createElement('canvas'), S, exportPx(S));

/* ================================================================ 通信 */
async function api(path, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api('/api/last', S).catch(() => {}), 600);
}

/* ================================================================ UI */
let toastTimer = 0;
function toast(msg, err = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', err);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), err ? 5000 : 2600);
}

function fontAvailable(name) {
  const c = document.createElement('canvas').getContext('2d');
  const t = '永国あア印Wm0';
  return ['monospace', 'serif', 'sans-serif'].some(fb => {
    c.font = `40px ${fb}`; const a = c.measureText(t).width;
    c.font = `40px "${name}", ${fb}`; const b = c.measureText(t).width;
    return Math.abs(a - b) > 0.5;
  });
}

function buildFonts() {
  fonts = FONT_CANDIDATES.filter(([f]) => fontAvailable(f));
  const sel = $('#inFont');
  sel.innerHTML = '';
  const list = fonts.length ? fonts : [['', '標準（明朝）']];
  for (const [f, label] of list) sel.add(new Option(label, f));
  if (!list.some(([f]) => f === S.font)) S.font = list[0][0];
}

function buildSwatches() {
  const box = $('#swatches');
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.type = 'button'; b.style.background = c.v; b.title = c.name;
    b.setAttribute('aria-label', c.name); b.dataset.color = c.v;
    b.addEventListener('click', () => { S.color = c.v; update(); });
    box.appendChild(b);
  }
  const pick = document.createElement('input');
  pick.type = 'color'; pick.id = 'inColor'; pick.title = '任意の色'; pick.setAttribute('aria-label', '任意の色');
  pick.addEventListener('input', () => { S.color = pick.value; update(); });
  box.appendChild(pick);
}

function buildSizes() {
  const box = $('#sizes');
  box.innerHTML = '';
  const cur = S.size[S.type];
  for (const mm of TYPES[S.type].sizes) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = `${mm}mm`;
    b.setAttribute('aria-pressed', String(mm === cur));
    b.addEventListener('click', () => { S.size[S.type] = mm; update(); });
    box.appendChild(b);
  }
  const wrap = document.createElement('label');
  wrap.className = 'custom';
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = '5'; inp.max = '60'; inp.step = '0.5'; inp.value = String(cur);
  inp.setAttribute('aria-label', '大きさ（mm）を直接入力');
  inp.addEventListener('change', () => {
    const v = Number(inp.value);
    if (!Number.isFinite(v) || v <= 0) { inp.value = String(S.size[S.type]); toast('大きさは 5〜60mm で入力してください', true); return; }
    S.size[S.type] = clamp(Math.round(v * 2) / 2, 5, 60);
    update();
  });
  wrap.append(inp, document.createTextNode('mm'));
  box.appendChild(wrap);
}

function syncUI() {
  $$('#typeTabs [data-type]').forEach(b => {
    const on = b.dataset.type === S.type;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
  });
  $$('[data-for]').forEach(el => el.classList.toggle('hidden', !el.dataset.for.split(' ').includes(S.type)));
  $$('[data-key]').forEach(el => {
    if (el === document.activeElement && el.type === 'text') return;
    const v = S[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
  });
  const di = $('#inDate');
  di.disabled = S.dateAuto;
  if (S.dateAuto || !S.date) di.value = todayISO();
  $$('[data-out]').forEach(o => {
    const k = o.dataset.out;
    o.textContent = k === 'tilt' ? `${S[k]}°` : String(S[k]);
  });
  $$('#swatches [data-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color.toLowerCase() === S.color.toLowerCase())));
  const pick = $('#inColor'); if (pick) pick.value = S.color;
  $$('[data-bg]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bg === S.bg)));
  $('#stage').className = `stage ${S.bg}`;
  buildSizes();
  const px = exportPx(S);
  $('#meta').textContent = `${TYPES[S.type].label}　${S.size[S.type]}mm ・ ${S.dpi}dpi → ${px}×${px}px`;
}

function draw() {
  const cv = $('#pv');
  const px = Math.round(Math.min(800, (cv.clientWidth || 300) * (window.devicePixelRatio || 1)));
  render(cv, S, Math.max(200, px));
}

let raf = 0;
function update() {
  syncUI();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
  scheduleSave();
}

/* ================================================================ 出力 */
function fileBase() {
  const d = stampDate(S);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  if (S.type === 'date') return `日付印_${S.name}_${ymd}`;
  if (S.type === 'square') return `角印_${S.square}`;
  return `認印_${S.name}`;
}

async function copyStamp() {
  try {
    const blob = await new Promise((res, rej) => exportCanvas().toBlob(b => (b ? res(b) : rej(new Error('画像の生成に失敗しました'))), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('コピーしました。貼り付け先で Ctrl+V');
  } catch (e) {
    toast(`コピーできませんでした：${e.message}`, true);
  }
}

async function saveStamp() {
  try {
    const j = await api('/api/save', { data: exportCanvas().toDataURL('image/png'), name: fileBase() });
    toast(`保存しました：${j.path}`);
  } catch (e) {
    toast(`保存できませんでした：${e.message}`, true);
  }
}

/* ================================================================ よく使う印 */
function renderPresets() {
  const bar = $('#presetBar');
  bar.innerHTML = '';
  presets.forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = 'pchip';
    const load = document.createElement('button');
    load.type = 'button'; load.className = 'load'; load.title = `「${p.name}」を呼び出す`;
    const cv = document.createElement('canvas');
    render(cv, merge(DEFAULTS, p.s), 52);
    load.append(cv, document.createTextNode(p.name));
    load.addEventListener('click', () => {
      S = merge(DEFAULTS, { ...p.s, bg: S.bg, dpi: p.s.dpi || S.dpi });
      if (!fonts.some(([f]) => f === S.font) && fonts.length) S.font = fonts[0][0];
      update();
      toast(`「${p.name}」を呼び出しました`);
    });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'del'; del.textContent = '×';
    del.setAttribute('aria-label', `「${p.name}」を削除`); del.title = '削除';
    del.addEventListener('click', async () => {
      if (!confirm(`「${p.name}」を削除しますか？`)) return;
      presets.splice(i, 1);
      renderPresets();
      try { await api('/api/presets', presets); } catch (e) { toast(e.message, true); }
    });
    chip.append(load, del);
    bar.appendChild(chip);
  });
}

function openPresetDialog() {
  const dlg = $('#dlgPreset');
  const inp = $('#inPresetName');
  inp.value = S.type === 'square' ? S.square.slice(0, 8) : `${TYPES[S.type].label} ${S.name}`.slice(0, 20);
  dlg.returnValue = '';
  dlg.showModal();
  inp.select();
}

$('#dlgPreset').addEventListener('close', async () => {
  const dlg = $('#dlgPreset');
  const name = $('#inPresetName').value.trim();
  if (dlg.returnValue !== 'ok' || !name) return;
  const s = clone(S); delete s.bg;
  const idx = presets.findIndex(p => p.name === name);
  if (idx >= 0) presets[idx] = { name, s }; else presets.push({ name, s });
  renderPresets();
  try { await api('/api/presets', presets); toast(`「${name}」を登録しました`); }
  catch (e) { toast(`登録できませんでした：${e.message}`, true); }
});

/* ================================================================ イベント */
function bind() {
  const tabs = $$('#typeTabs [data-type]');
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => { S.type = b.dataset.type; update(); });
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const nb = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      nb.focus(); nb.click();
    });
  });

  $$('[data-key]').forEach(el => {
    const ev = el.type === 'text' || el.type === 'range' ? 'input' : 'change';
    el.addEventListener(ev, () => {
      const k = el.dataset.key;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'range' || k === 'dpi') v = Number(el.value);
      else v = el.value;
      if (typeof v === 'number' && !Number.isFinite(v)) return;
      if (k === 'date' && !v) v = todayISO();
      if (k === 'dateAuto' && !v && !S.date) S.date = todayISO();
      S[k] = v;
      update();
    });
  });

  $$('[data-bg]').forEach(b => b.addEventListener('click', () => { S.bg = b.dataset.bg; update(); }));
  $('#btnReseed').addEventListener('click', () => {
    S.seed = 1 + Math.floor(Math.random() * 100000);
    if (S.kasure === 0) S.kasure = ADV_DEFAULTS.kasure;
    update();
  });
  $('#btnResetAdv').addEventListener('click', () => { Object.assign(S, ADV_DEFAULTS); update(); });
  $('#btnCopy').addEventListener('click', copyStamp);
  $('#btnSave').addEventListener('click', saveStamp);
  $('#btnFolder').addEventListener('click', () => api('/api/open-folder', {}).catch(e => toast(e.message, true)));
  $('#btnAddPreset').addEventListener('click', openPresetDialog);
  $('#btnOutSave').addEventListener('click', async () => {
    try {
      const j = await api('/api/config', { outputDir: $('#inOut').value });
      $('#inOut').value = j.outputDir;
      toast('保存先を変更しました');
    } catch (e) { toast(e.message, true); }
  });

  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 'enter') { e.preventDefault(); copyStamp(); }
    else if (key === 's') { e.preventDefault(); saveStamp(); }
    else if (key === 'c') {
      const t = e.target;
      const typing = t.matches && t.matches('input[type=text],input[type=number],input[type=date],textarea');
      if (!typing && !String(window.getSelection())) { e.preventDefault(); copyStamp(); }
    }
  });

  // 日付の自動更新（日付をまたいで開きっぱなしの場合）
  const refresh = () => { if (S.type === 'date' && S.dateAuto) update(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('focus', refresh);
  window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
}

/* ================================================================ 起動 */
async function init() {
  let st = {};
  try { st = await api('/api/state'); } catch (e) { toast('設定を読み込めませんでした（初期値で起動）', true); }
  S = merge(DEFAULTS, st.last);
  presets = Array.isArray(st.presets) ? st.presets.filter(p => p && p.name && p.s) : [];
  $('#inOut').value = st.outputDir || '';
  buildFonts();
  buildSwatches();
  bind();
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  renderPresets();
  update();
}
init();
})();

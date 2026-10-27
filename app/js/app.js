import { backend } from './backend.js';
import { fill, h } from './dom.js';
import { createNotices, createSettings, loadHistory } from './settings.js';
import { ADV_DEFAULTS, COLORS, DEFAULTS, FONT_CANDIDATES, TYPES, clamp, clone, dateText, exportPx, merge, render, stampDate, todayISO } from './stamp.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let S = clone(DEFAULTS);
let presets = [];
let fonts = [];

const exportCanvas = () => render(document.createElement('canvas'), S, exportPx(S));

/* ================================================================ 通信 */
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => backend.saveLast(S).catch(() => {}), 600);
}
const pngBytes = cv => new Promise((res, rej) => cv.toBlob(b => (b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error('画像の生成に失敗しました'))), 'image/png'));

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
  // 決まった色に無い色: 名前の付いた札（色だけの四角にしない）
  const pick = h('input', { type: 'color', id: 'inColor', 'aria-label': 'その他の色を選ぶ' });
  pick.addEventListener('input', () => { S.color = pick.value; update(); });
  box.appendChild(h('label', { class: 'pick-other', title: '決まった色に無い色を選ぶ' }, pick, 'その他の色'));
}

// 大きさ: 単位（mm）は見出しに 1 回だけ。決まった大きさに無いときだけ「その他」の箱に値が出る（同じ値を 2 回並べない）
function buildSizes() {
  const box = $('#sizes');
  const cur = S.size[S.type];
  const sizes = TYPES[S.type].sizes;
  const inp = h('input', { type: 'number', min: 5, max: 60, step: 0.5, placeholder: 'その他', value: sizes.includes(cur) ? '' : cur,
    'aria-label': '大きさ（mm）を直接入れる', title: '5〜60mm を 0.5mm 刻みで' });
  inp.addEventListener('change', () => {
    if (inp.value === '') return;
    const v = Number(inp.value);
    if (!Number.isFinite(v) || v < 5 || v > 60) { toast('大きさは 5〜60mm で入れてください', true); return update(); }
    S.size[S.type] = clamp(Math.round(v * 2) / 2, 5, 60);
    update();
  });
  fill(box, sizes.map(mm => h('button', { type: 'button', 'aria-pressed': String(mm === cur), onclick: () => { S.size[S.type] = mm; update(); } }, mm)), inp);
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
  const pick = $('#inColor');
  if (pick) {
    pick.value = S.color;
    pick.parentElement.setAttribute('aria-pressed', String(!COLORS.some(c => c.v.toLowerCase() === S.color.toLowerCase())));
  }
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
  openAdvancedIfRoom();
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
    const bytes = await pngBytes(exportCanvas());
    const r = await backend.copyPng(bytes, S.dpi);
    if (!r || r.native === false) await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    toast('コピーしました。貼り付け先で Ctrl+V');
  } catch (e) {
    toast(`コピーできませんでした：${e.message}`, true);
  }
}

async function saveStamp() {
  try {
    const j = await backend.savePng(await pngBytes(exportCanvas()), fileBase(), S.dpi);
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
    render(cv, merge(DEFAULTS, p.s), 72);   // 見本は 36px の表示を 2 倍の細かさで（表示倍率 125〜200% でもぼやけない）
    load.append(cv, h('span', { class: 'nm' }, p.name));
    load.addEventListener('click', () => {
      S = merge(DEFAULTS, { ...p.s, bg: S.bg, dpi: S.dpi });   // 解像度は設定（印ごとではない）
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
      try { await backend.savePresets(presets); } catch (e) { toast(e.message, true); }
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
  try { await backend.savePresets(presets); toast(`「${name}」を登録しました`); }
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
  $('#btnFolder').addEventListener('click', () => backend.openFolder().catch(e => toast(e.message, true)));
  $('#btnAddPreset').addEventListener('click', openPresetDialog);
  $('#btnSettings').addEventListener('click', () => $('#dlgSettings').showModal());
  $$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

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
  try { st = await backend.load(); } catch (e) { toast('設定を読み込めませんでした（初期値で起動）', true); }
  S = merge(DEFAULTS, st.last);
  presets = Array.isArray(st.presets) ? st.presets.filter(p => p && p.name && p.s) : [];
  settings.refresh(st);
  notices.refresh(st);
  markUpdate(st.update);
  buildFonts();
  buildSwatches();
  bind();
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  renderPresets();
  update();
  openAdvancedIfRoom();
  $('details.adv > summary').addEventListener('click', () => { advAuto = false; });   // 利用者が自分で開け閉めした
  addEventListener('resize', openAdvancedIfRoom);
  bindWindow();
  backend.ready().catch(() => {});
}

// 背の高い窓では詳細設定を開いておく（入力の列の空きを、使える操作で埋める）。開いて列に収まらなければ閉じる。
// 種類を変えて入力が長くなったとき・窓の大きさを変えたときも確かめ直す。利用者が自分で開け閉めしたら、その形を守る
let advAuto = true;
function openAdvancedIfRoom() {
  if (!advAuto) return;
  const adv = $('details.adv'), panel = $('.panel');
  adv.open = innerHeight >= 860;
  if (adv.open && panel.scrollHeight > panel.clientHeight + 1) adv.open = false;
}

/** 新しい版を取り込んでいれば、設定のボタンに札を付ける（知らせの帯を閉じても、どこにあるか分かる） */
function markUpdate(u) {
  if (u?.state === 'ready') $('#btnSettings').setAttribute('data-badge', '新しい版');
  else $('#btnSettings').removeAttribute('data-badge');
}

/* ================================================================ 設定と知らせ */
const settings = createSettings($('#settings'), {
  backend, toast,
  getDpi: () => S.dpi,
  setDpi: (v) => { S.dpi = v; update(); },
  openHistory: () => openHistory(),
  onChange: () => notices.refresh(settings.state),
});
const notices = createNotices($('#notices'), { backend, toast, onChange: () => settings.refresh({}) });

async function openHistory() {
  const list = await loadHistory();
  fill($('#history'), list.map(e => h('section', {}, h('h2', {}, `版 ${e.version}`, h('small', {}, e.date)), h('ul', {}, e.notes.map(n => h('li', {}, n))))));
  $('#dlgHistory').showModal();
}

/* ================================================================ 窓からの知らせ */
// トレイの「押すとコピー」: 窓が隠れていても、ここで描いて Rust のクリップボードへ置き、右下に知らせを出す
function bindWindow() {
  backend.on('ps:copy', async (which) => {
    const p = which === 'last' ? { name: '前回の印', s: S } : presets[Number(which)];
    if (!p) return;
    try {
      const s = merge(DEFAULTS, { ...p.s, dpi: S.dpi });
      const bytes = await pngBytes(render(document.createElement('canvas'), s, exportPx(s)));
      await backend.copyPng(bytes, s.dpi);
      backend.notify?.(`「${p.name}」をコピーしました。貼り付け先で Ctrl+V`);
    } catch (e) {
      backend.notify?.(`コピーできませんでした：${e.message}`);
    }
  });
  backend.on('ps:shown', () => { if (S.type === 'date' && S.dateAuto) update(); });
  backend.on('ps:update', (u) => { settings.setUpdate(u); notices.setUpdate(u); markUpdate(u); });
  backend.on('ps:settings', async () => settings.refresh(await backend.load()));
}

// 自己診断（desktop/src/selftest.js）が使う口: 印を書き出す（画面の描き方そのまま）
window.__ps = {
  /** 今の設定に s を重ねて px の大きさで描いた canvas（見本帳・評価関数が使う） */
  async drawStamp(s, px, opts) {
    return render(document.createElement('canvas'), merge(DEFAULTS, { ...S, ...s }), px, opts);
  },
  async exportStamp({ type, dpi }) {
    const s = merge(DEFAULTS, { ...S, type, dpi });
    const px = exportPx(s);
    return { px, mm: s.size[type], bytes: await pngBytes(render(document.createElement('canvas'), s, px)) };
  },
};

init();

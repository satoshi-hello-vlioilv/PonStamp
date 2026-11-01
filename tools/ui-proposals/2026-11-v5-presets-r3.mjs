// 改良案（2026-11・v5・3 回目・最後の回）: 2 回目（1 位 A2 77.2 点）の指摘を直し、案出しからやり直す。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-11-v5-presets-r3.mjs --view 1728x1152 --states mitome,edited,check,organize
// 持ち越し: A3・C3（A2・C2 を直した物）。新しい案: I（呼び出した札に操作）・J（プレビューの角に編集中・削除は 1 手で元に戻せる）・K（使う｜整える）
// 2 回目の指摘と直し:
//   - 灰色の「…」は中身が分からない → 入口に言葉（「直す ▾」）
//   - 「変えています」が帯だけで、目が向く入力・プレビューの側に出ない → 出す。入力の列は動かさない（場所を先に取る・プレビューの側に出す）
//   - 帯の「コピー」が登録した形か変えた後か分からない → 変えている間は札に「登録した形」と書く
//   - 削除が 1 手 → 2 手 → J・K は 1 手で消して「元に戻す」
//   - 確かめの窓の手順 3 の折り返し → 文を短く（全案）
//   - G の 1728 の崩れ（広がった札の中身が外へ）→ G は持ち越さない。I は札の下に別の行として出す

import { SEED } from '../ui-harness.mjs';

const BASE = `
const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const presets = () => { try { return JSON.parse(localStorage.getItem('ponstamp.state')).presets || []; } catch { return []; } };
let loaded = -1, dirty = false; const hooks = [];
const emit = () => hooks.forEach((f) => f({ loaded, dirty, name: presets()[loaded]?.name }));
document.addEventListener('click', (e) => { const b = e.target.closest('.pchip .load'); if (!b) return; loaded = $$('.pchip').indexOf(b.closest('.pchip')); dirty = false; setTimeout(emit); }, true);
const onEdit = (e) => { if (loaded >= 0 && e.target.closest('.panel')) { dirty = true; emit(); } };
document.addEventListener('input', onEdit, true); document.addEventListener('change', onEdit, true);
const drawRuler = (cv, wpx) => { const mm = 50, h = 16, k = wpx / mm; cv.width = wpx; cv.height = Math.round(h * k); const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#111'; const ln = Math.max(1, Math.round(k * 0.15));
  c.fillRect(0, 0, cv.width, ln); c.fillRect(0, cv.height - ln, cv.width, ln); c.fillRect(0, 0, ln, cv.height); c.fillRect(cv.width - ln, 0, ln, cv.height);
  for (let i = 1; i < mm; i++) { const len = (i % 10 === 0 ? 7 : i % 5 === 0 ? 5 : 3) * k; c.fillRect(Math.round(i * k - ln / 2), 0, ln, Math.round(len)); }
  c.textAlign = 'center'; c.font = (3.2 * k) + 'px sans-serif'; for (let cm = 1; cm < 5; cm++) c.fillText(String(cm), cm * 10 * k, 10.6 * k);
  c.font = 'bold ' + (2.6 * k) + 'px sans-serif'; c.fillText('枠の幅 50 mm', cv.width / 2, 14.4 * k); };
const checkDialog = () => { let d = $('#dlgCheck'); if (d) return d; d = mk('dialog', 'check-dlg'); d.id = 'dlgCheck';
  d.innerHTML = '<div class="dlg-head"><h1>貼り付けの大きさを確かめる</h1><button type="button" class="btn small quiet" data-x>閉じる</button></div>'
   + '<div class="ck"><canvas class="ruler"></canvas><ol><li>「ものさしをコピー」を押す</li><li>Word・Excel・PowerPoint に Ctrl+V で貼る</li><li>貼った図を選び、「図の形式」→「サイズ」の幅が <b>50 mm</b> か見る</li></ol>'
   + '<div class="row"><button type="button" class="btn primary small">ものさしをコピー</button><button type="button" class="btn small">PNG で保存</button></div>'
   + '<p class="hint">いまの解像度（600 dpi）で、印と同じ道（コピー・保存）を通します。50 mm でなければ、PNG で保存してファイルから挿入してください。</p></div>';
  document.body.append(d); d.querySelector('[data-x]').onclick = () => d.close(); drawRuler(d.querySelector('canvas'), 560); return d; };
const openCheck = () => checkDialog().showModal();
window.__ui = { openCheck, organize: () => {}, load: (i) => $$('.pchip .load')[i]?.click() };
/** 札: 番号（広い画面の大きな札だけ・角）・「コピー」・「…」（× の代わり） */
const chips = (entry = '…') => { const run = () => $$('.pchip').forEach((chip, i) => { if (chip.querySelector('.cp')) return;
  if (i < 9) chip.append(mk('span', 'num', String(i + 1)));
  const b = mk('button', 'cp', 'コピー'); b.type = 'button'; b.title = 'コピー（Ctrl+' + (i + 1) + '）'; b.setAttribute('aria-label', '「' + (presets()[i]?.name || '') + '」をコピー');
  const d = chip.querySelector('.del'); d.className = 'more' + (entry === '…' ? '' : ' lbl'); d.textContent = entry; d.title = '上書き・名前・並べ替え・削除'; d.setAttribute('aria-label', '「' + (presets()[i]?.name || '') + '」のメニュー'); d.before(b); });
  new MutationObserver(run).observe($('#presetBar'), { childList: true }); run(); };
/** 「…」のメニュー（E を持ち越す。削除は区切り線の下・赤。押せない所は薄く） */
const menuFor = (i) => { $('.pmenu')?.remove(); const c = $$('.pchip')[i]; const r = c.getBoundingClientRect(); const n = presets().length;
  const m = mk('div', 'pmenu', '<button>いまの印で上書き</button><button>名前を変える…</button><hr><button' + (i === 0 ? ' class="off"' : '') + '>上へ</button><button' + (i === n - 1 ? ' class="off"' : '') + '>下へ</button><hr><button class="danger">削除…</button>');
  m.style.left = Math.min(r.right - 4, innerWidth - 220) + 'px'; m.style.top = r.top + 'px'; document.body.append(m); };
const tipCtrl = () => { const t = $('.preview > .hint.center'); if (t) t.textContent = 'Excel・Word などで Ctrl+V で貼り付け。登録した印は Ctrl+1〜9 でもコピー'; };
`;
const COMMON_CSS = `
:root { --rail: 256px; }
.check-dlg { width: min(640px, calc(100vw / var(--zoom) - 48px)); }
.check-dlg .ck { display: flex; flex-direction: column; gap: 12px; padding: 4px 18px 18px; }
.check-dlg canvas.ruler { width: 100%; height: auto; border-radius: 4px; box-shadow: 0 0 0 1px var(--line); }
.check-dlg ol { margin: 0; padding-left: 20px; } .check-dlg .hint { margin: 0; }
.pchip { position: relative; }
.pchip .num { display: none; }
.pchip .cp { flex: none; height: 26px; padding: 0 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--text); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.pchip .cp:hover { border-color: var(--accent); color: var(--accent); }
.pchip .more { flex: none; border: 0; background: none; color: var(--muted); width: 24px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 16px; } .pchip .more:hover { background: var(--line); color: var(--text); }
.pchip.on { background: var(--panel); border-color: var(--accent); }
.pmenu { position: fixed; z-index: 5; min-width: 200px; padding: 6px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 8px 24px rgba(0,0,0,.16); display: flex; flex-direction: column; }
.pmenu button { text-align: left; border: 0; background: none; color: var(--text); font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.pmenu button:hover { background: var(--chip); } .pmenu hr { border: 0; border-top: 1px solid var(--line); margin: 4px 2px; } .pmenu .danger { color: var(--accent); } .pmenu .off { color: var(--muted); opacity: .55; }
.btn.outline { border-color: var(--accent); color: var(--accent); font-weight: 700; background: var(--panel); }
.dirty-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-left: 6px; vertical-align: 2px; }
@media (min-width: 1600px) and (min-height: 1000px) { :root { --rail: 300px; } .rail .pchip .num { display: inline-grid; place-items: center; position: absolute; top: 6px; left: 6px; width: 18px; height: 18px; border-radius: 4px; border: 1px solid var(--line); background: var(--chip); font-size: 11px; font-weight: 700; color: var(--muted); }
  .rail .pchip .cp { width: 100%; height: 28px; } .rail .pchip .more { position: absolute; top: 2px; right: 2px; } }
`;
const EDIT_BAR = `
const editBar = (where) => { const bar = mk('div', 'editbar'); bar.hidden = true; where(bar);
  hooks.push(({ loaded: i, dirty: d, name }) => { bar.hidden = i < 0; $$('.pchip').forEach((c, k) => c.classList.toggle('on', k === i)); if (i < 0) return;
    bar.innerHTML = '<span class="eb-t">編集中: <b>' + name + '</b>' + (d ? '<span class="dirty-dot" aria-hidden="true"></span><small>変更あり</small>' : '<small class="same">登録したまま</small>') + '</span>';
    const acts = mk('span', 'eb-a'); if (d) { acts.append(mk('button', 'btn small outline', '「' + name + '」に上書き'), mk('button', 'btn small', '新しく登録')); } bar.append(acts); }); };
`;
const EDIT_CSS = `
.editbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 8px; background: var(--panel); font-size: 13px; }
.editbar[hidden] { display: none; } .editbar small { margin-left: 4px; font-size: 12px; color: var(--accent); font-weight: 700; } .editbar small.same { color: var(--muted); font-weight: 400; }
.editbar .eb-a { display: flex; gap: 6px; } .editbar .btn { white-space: nowrap; }
`;
const CHECK_LINK_CSS = `.checklink { border: 0; background: none; color: var(--focus); font: inherit; font-size: 12px; cursor: pointer; padding: 0; }`;


const BASE2 = `
/** 変えている間、呼び出した札の名前の下に「登録した形」（札のコピーは登録した形をコピーする） */
hooks.push(({ loaded: i, dirty: d }) => $$('.pchip').forEach((c, k) => { c.classList.toggle('on', k === i); c.querySelector('.reg-form')?.remove();
  if (k === i && d) c.querySelector('.nm').after(mk('small', 'reg-form', '登録した形')); }));
/** 元に戻せる知らせ */
const undoToast = (text) => { $('.toast3')?.remove(); const t = mk('div', 'toast3', '<span>' + text + '</span>'); t.append(mk('button', '', '元に戻す')); document.body.append(t); };
`;
const CSS2 = `
.pchip .more.lbl { width: auto; padding: 0 6px; font-size: 12px; color: var(--text); border: 1px solid var(--line); background: var(--panel); }
:root { --rail: 272px; }
.pchip .reg-form { position: absolute; left: 52px; bottom: 2px; font-size: 11px; color: var(--muted); } .pchip.on:has(.reg-form) { padding-bottom: 16px; }
@media (min-width: 1600px) and (min-height: 1000px) { :root { --rail: 300px; } .rail .pchip .reg-form { position: static; } .rail .pchip.on:has(.reg-form) { padding-bottom: 8px; } .rail .pchip:has(.more.lbl) { display: grid; grid-template-columns: 1fr auto; gap: 6px; } .rail .pchip:has(.more.lbl) .load { grid-column: 1 / -1; }
  .rail .pchip .more.lbl { position: static; height: 28px; } }
.toast3 { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px; background: var(--text); color: var(--panel); font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,.2); z-index: 6; }
.toast3 button { border: 1px solid color-mix(in srgb, var(--panel) 45%, transparent); background: none; color: var(--panel); font: inherit; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 6px; cursor: pointer; }
.meta .edit-tag { margin-left: 8px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); font-size: 12px; font-weight: 700; }
`;

export const EXTRA_STATES = [
  { name: 'edited', seed: SEED, run: async (page) => { await page.evaluate(() => window.__ui.load(0)); await page.fill('#inName', '山田太郎'); await page.waitForTimeout(3000); } },
  { name: 'check', seed: SEED, run: async (page) => { await page.evaluate(() => window.__ui.openCheck()); await page.waitForTimeout(150); } },
  { name: 'organize', seed: SEED, run: async (page) => { await page.evaluate(() => window.__ui.organize()); await page.waitForTimeout(150); } },
];

/** プレビューの寸法の行に「編集中: 名前 変更あり」（入力の列は動かない） */
const META_TAG = `
const meta = $('#meta'); const tag = mk('span', 'edit-tag'); tag.hidden = true;
const keep = () => { if (!meta.contains(tag)) meta.append(tag); }; new MutationObserver(keep).observe(meta, { childList: true, characterData: true, subtree: true }); keep();
hooks.push(({ loaded: i, dirty: d, name }) => { tag.hidden = !(i >= 0 && d); tag.textContent = '「' + name + '」から変えています'; });
`;

export const PROPOSALS = [
  {
    key: 'A3', name: '札にコピーと「直す ▾」。呼び出して変えると、帯の登録の所が「上書き（枠）／新しく登録」に分かれ、プレビューの寸法の行にも「変えています」。確かめはコピーの説明の下（A2 を直した物）',
    css: COMMON_CSS + CHECK_LINK_CSS + CSS2 + `.reg2 { display: grid; gap: 4px; } .reg2 .btn { width: 100%; }`,
    ops: [['script', `${BASE}${BASE2}${META_TAG}
chips('直す ▾'); tipCtrl();
const add = $('#btnAddPreset'); const reg = mk('div', 'reg2'); add.before(reg); reg.append(add);
hooks.push(({ loaded: i, dirty: d, name }) => { reg.querySelectorAll('.ow').forEach((e) => e.remove());
  if (i >= 0 && d) { reg.prepend(mk('button', 'btn small outline ow', '「' + name + '」に上書き')); add.textContent = '＋ 新しく登録'; } else add.textContent = '＋ いまの印を登録'; });
const hint = $('.preview > .hint.center'); const l = mk('button', 'checklink', '貼った大きさが違うときは → 大きさを確かめる'); l.type = 'button'; l.onclick = openCheck; hint.after(l);
window.__ui.organize = () => menuFor(1);`]],
  },
  {
    key: 'C3', name: '入力の上に「いまの印」の行をいつも置く（新しい印／編集中: 名前・変更あり・上書き（枠））。入力の列は動かない。札にコピーと「直す ▾」。確かめは寸法の隣（C2 を直した物）',
    css: COMMON_CSS + CHECK_LINK_CSS + CSS2 + `.nowline { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 34px; padding: 0 2px 0 10px; border-left: 3px solid var(--line); font-size: 13px; color: var(--muted); }
.nowline.on { border-left-color: var(--accent); color: var(--text); } .nowline small { margin-left: 6px; font-size: 12px; color: var(--accent); font-weight: 700; } .meta .checklink { margin-left: 8px; }`,
    ops: [['script', `${BASE}${BASE2}
chips('直す ▾'); tipCtrl();
const line = mk('div', 'nowline', '<span>いまの印: 新しい印（＋ いまの印を登録 で登録）</span>'); $('.panel').prepend(line);
hooks.push(({ loaded: i, dirty: d, name }) => { line.classList.toggle('on', i >= 0); if (i < 0) return;
  line.innerHTML = '<span>いまの印: <b>' + name + '</b>' + (d ? '<small>● 変更あり</small>' : ' （登録したまま）') + '</span>'; if (d) line.append(mk('button', 'btn small outline', '「' + name + '」に上書き')); });
const meta = $('#meta'); const l = mk('button', 'checklink', '大きさを確かめる'); l.type = 'button'; l.onclick = openCheck;
new MutationObserver(() => { if (!meta.contains(l)) meta.append(l); }).observe(meta, { childList: true, characterData: true, subtree: true }); meta.append(l);
window.__ui.organize = () => menuFor(1);`]],
  },
  {
    key: 'I', name: '呼び出した札の下に、その印の操作の行（上書き（変えたとき）・名前・上へ・下へ・削除）。ほかの札はコピーだけで静か（選んだ物に操作が出る型）。寸法の行に「変えています」。確かめはコピーの説明の下',
    css: COMMON_CSS + CHECK_LINK_CSS + CSS2 + `.pchip .more { display: none; }
.pacts { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 6px 8px; margin: -2px 0 4px; border: 1px solid var(--accent); border-top: 0; border-radius: 0 0 8px 8px; background: var(--panel); }
.pacts .btn { height: 26px; padding: 0 8px; font-size: 12px; } .pacts .danger { color: var(--accent); }
.pchip.on { border-radius: 8px 8px 0 0; }
@media (min-width: 1600px) and (min-height: 1000px) { .rail .pacts { grid-column: 1 / -1; margin-top: -8px; } .rail .pchip.on { border-radius: 10px; } }`,
    ops: [['script', `${BASE}${BASE2}${META_TAG}
chips(); tipCtrl();
hooks.push(({ loaded: i, dirty: d, name }) => { $('.pacts')?.remove(); if (i < 0) return; const c = $$('.pchip')[i]; const n = presets().length;
  const a = mk('div', 'pacts'); if (d) a.append(mk('button', 'btn small outline', 'この印に上書き'));
  a.append(mk('button', 'btn small', '名前…')); const up = mk('button', 'btn small', '↑ 上へ'); up.disabled = i === 0; const dn = mk('button', 'btn small', '↓ 下へ'); dn.disabled = i === n - 1; a.append(up, dn, mk('button', 'btn small danger', '削除')); c.after(a); });
const hint = $('.preview > .hint.center'); const l = mk('button', 'checklink', '貼った大きさが違うときは → 大きさを確かめる'); l.type = 'button'; l.onclick = openCheck; hint.after(l);
window.__ui.organize = () => window.__ui.load(1);`]],
  },
  {
    key: 'J', name: '編集中と上書きはプレビューの台の左上に（目が向く所）。札はコピーと × （消すと「元に戻す」が出る・1 手）。名前と順は札の「直す ▾」。確かめはコピーの説明の下',
    css: COMMON_CSS + CHECK_LINK_CSS + CSS2 + `.stage { position: relative; } .stagetag { position: absolute; left: 10px; top: 10px; display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 10px; border-radius: 8px; background: var(--panel); border: 1px solid var(--accent); font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.stagetag[hidden] { display: none; } .stagetag b { color: var(--accent); }
.pchip .x { position: absolute; top: -6px; right: -6px; z-index: 2; width: 18px; height: 18px; padding: 0; border: 1px solid var(--line); background: var(--panel); color: var(--muted); border-radius: 50%; cursor: pointer; font-size: 11px; line-height: 1; } .pchip .x:hover { background: var(--line); color: var(--text); }
`,
    ops: [['script', `${BASE}${BASE2}
chips('直す ▾'); tipCtrl();
const x = () => $$('.pchip').forEach((c) => { if (c.querySelector('.x')) return; const b = mk('button', 'x', '×'); b.title = '削除（あとで元に戻せます）'; c.append(b); }); new MutationObserver(x).observe($('#presetBar'), { childList: true }); x();
const st = $('#stage'); const tg = mk('div', 'stagetag'); tg.hidden = true; st.append(tg);
hooks.push(({ loaded: i, dirty: d, name }) => { tg.hidden = !(i >= 0 && d); if (tg.hidden) return; tg.innerHTML = '<span><b>●</b> 「' + name + '」から変えています</span>'; tg.append(mk('button', 'btn small outline', '上書き'), mk('button', 'btn small', '新しく登録')); });
const hint = $('.preview > .hint.center'); const l = mk('button', 'checklink', '貼った大きさが違うときは → 大きさを確かめる'); l.type = 'button'; l.onclick = openCheck; hint.after(l);
window.__ui.organize = () => undoToast('「日付印 総務」を消しました');`]],
  },
  {
    key: 'K', name: '帯の上に「使う｜整える」の切り替え。使う＝札とコピー、整える＝名前の欄・▲▼・削除（元に戻せる）の一覧。編集中は寸法の行に、上書きは帯の登録の所（A3 と同じ）。確かめはコピーの説明の下',
    css: COMMON_CSS + CHECK_LINK_CSS + CSS2 + `.pchip .more { display: none; } .reg2 { display: grid; gap: 4px; } .reg2 .btn { width: 100%; }
.rmode { display: grid; grid-template-columns: 1fr 1fr; padding: 3px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); }
.rmode button { border: 0; background: none; font: inherit; font-size: 12px; padding: 4px; border-radius: 6px; color: var(--muted); cursor: pointer; } .rmode button[aria-pressed="true"] { background: var(--chip); color: var(--text); font-weight: 700; }
.rail.tidy .presets { display: flex !important; flex-direction: column; gap: 4px; }
.rail.tidy .pchip { flex-direction: row !important; padding: 4px 6px !important; background: var(--panel); border-color: var(--line); } .rail.tidy .pchip .load canvas { width: 28px !important; height: 28px !important; }
.rail.tidy .pchip .cp, .rail.tidy .pchip .num { display: none !important; } .rail.tidy .pchip .load { flex-direction: row !important; flex: 0 0 auto; }
.rail.tidy .pchip .nm { display: none; } .rail.tidy .pchip input { flex: 1; min-width: 0; height: 28px; padding: 0 6px; border: 1px solid var(--line); border-radius: 6px; font: inherit; font-size: 13px; background: var(--panel); color: var(--text); }
.rail.tidy .ud { display: flex; gap: 2px; } .rail.tidy .ud button { width: 24px; height: 26px; border: 1px solid var(--line); background: var(--panel); border-radius: 6px; cursor: pointer; color: var(--text); font-size: 11px; } .rail.tidy .ud button:disabled { opacity: .4; }
.rail.tidy .dx { border: 0; background: none; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; }`,
    ops: [['script', `${BASE}${BASE2}${META_TAG}
chips(); tipCtrl();
const mode = mk('div', 'rmode', '<button aria-pressed="true">使う</button><button aria-pressed="false">整える</button>'); $('.rail-h').after(mode);
const add = $('#btnAddPreset'); const reg = mk('div', 'reg2'); add.before(reg); reg.append(add);
hooks.push(({ loaded: i, dirty: d, name }) => { reg.querySelectorAll('.ow').forEach((e) => e.remove());
  if (i >= 0 && d) { reg.prepend(mk('button', 'btn small outline ow', '「' + name + '」に上書き')); add.textContent = '＋ 新しく登録'; } else add.textContent = '＋ いまの印を登録'; });
const hint = $('.preview > .hint.center'); const l = mk('button', 'checklink', '貼った大きさが違うときは → 大きさを確かめる'); l.type = 'button'; l.onclick = openCheck; hint.after(l);
window.__ui.organize = () => { $('.rail').classList.add('tidy'); const [u, t] = mode.querySelectorAll('button'); u.setAttribute('aria-pressed', 'false'); t.setAttribute('aria-pressed', 'true'); const n = presets().length;
  $$('.pchip').forEach((c, i) => { const inp = mk('input'); inp.value = presets()[i].name; c.querySelector('.load').after(inp);
    c.append(mk('span', 'ud', '<button' + (i === 0 ? ' disabled' : '') + ' title="上へ">▲</button><button' + (i === n - 1 ? ' disabled' : '') + ' title="下へ">▼</button>'), mk('button', 'dx', '削除')); }); };`]],
  },
];

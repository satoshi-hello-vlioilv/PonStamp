// 改良案（2026-10・2 回目）: 1 回目の採点（2026-10-main.score.json。1 位 A 72.2 点）の低い項目と減点を直し、案出しからやり直す。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-10-main-r2.mjs --view 1728x1152
// 持ち越し: A2（A を直した物）・D2（D の手の流れを直した物）。新しい案: F・G・H。全案に同じ直し（COMMON）を当てる。

const when = `const when = (sel, f) => { const t = setInterval(() => { const el = document.querySelector(sel); if (el) { clearInterval(t); f(el); } }, 20); };`;

/**
 * 全案に共通の直し（1 回目の指摘 1〜7 のうち、並べ方に依らない物）:
 * 窓の高さにぴったり収める（頁ごと送らない・左右の箱は同じ高さ）／大きさは単位を見出しだけ・直接入力の箱をボタンと同じ高さ／
 * 「その他の色」を揃える／赤い塗りはコピーだけ（知らせ・配布のボタンは枠だけ）／設定を開いている間は知らせの帯を隠す
 */
const COMMON_CSS = `
html, body { height: 100%; }
body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.top, .notices { flex: none; }
.notices { width: 100%; max-width: 1480px; }
.layout { flex: 1; min-height: 0; width: 100%; max-width: 1480px; align-items: stretch; }
.panel { min-height: 0; overflow-y: auto; }
.preview { min-height: 0; justify-content: center; }
.stage { width: min(100%, 640px, calc(100vh - 340px)); max-width: none; }
body:has(.notices:not([hidden])) .stage { width: min(100%, 640px, calc(100vh - 410px)); }
.sizes { flex-wrap: nowrap; gap: 4px; }
.sizes button { height: 34px; padding: 0 11px; font-variant-numeric: tabular-nums; }
.sizes .custom { font-size: 0; }
.sizes .custom input { width: 70px; height: 34px; font-size: 14px; border-radius: 999px; text-align: center; }
.field label.pick-other { display: inline-flex; white-space: nowrap; margin: 0; align-items: center; gap: 6px; height: 34px; padding: 0 12px 0 4px; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; line-height: 1; color: var(--text); cursor: pointer; }
.pick-other input[type=color] { display: block; margin: 0; width: 26px; height: 26px; border: 0; padding: 0; border-radius: 50%; overflow: hidden; }
.notice .btn.primary, .settings .versions .btn.primary { background: var(--panel); color: var(--info); border-color: var(--info); font-weight: 700; }
body:has(dialog[open]) .notices { display: none; }
[data-badge]::after { content: attr(data-badge); margin-left: 6px; padding: 0 7px; border-radius: 999px; background: var(--info); color: #fff; font-size: 11px; font-weight: 700; }
.panel hr { border: 0; border-top: 1px solid var(--line); margin: 0; }
`;
const COMMON_JS = `${when}
when('#sizes', (box) => {
  const lbl = box.closest('.field').querySelector('.lbl'); if (lbl) lbl.textContent = '大きさ（mm・印影の直径／一辺）';
  const strip = () => box.querySelectorAll('button').forEach((b) => { if (b.textContent.endsWith('mm')) b.textContent = b.textContent.slice(0, -2); });
  strip(); new MutationObserver(strip).observe(box, { childList: true });
});
when('#inColor', (el) => { const l = document.createElement('label'); l.className = 'pick-other'; el.replaceWith(l); l.append(el, document.createTextNode('その他の色')); });
when('#notices [data-id="update"]', () => document.querySelectorAll('[data-open="settings"]').forEach((b) => b.setAttribute('data-badge', '新しい版')));
// 見出しを重ねずに、文字と見た目の間を線で分ける
const sep = document.createElement('hr'); document.querySelector('#swatches').closest('.field').before(sep);
`;

/** 右から引き出す設定 */
const DRAWER_CSS = `
.settings-dlg { margin: 0 0 0 auto; height: 100vh; max-height: 100vh; width: min(620px, 92vw); border-radius: 0; border: 0; border-left: 1px solid var(--line); }
.settings-dlg::backdrop { background: rgba(15, 20, 30, .18); }
`;

/** 左に入力・右に大きなプレビュー */
const WIDE_CSS = `.layout { grid-template-columns: minmax(380px, 430px) 1fr; }`;

/** 詳細設定をつめる（2 列の帯・ボタン 1 段） */
const ADV_TIGHT = `
.adv-body { gap: 8px; }
.adv-body .range { grid-template-columns: 72px 1fr 34px; }
`;

export const PROPOSALS = [
  {
    key: 'A2', name: '作業台と引き出し・窓に収める（A を直した物）',
    css: COMMON_CSS + DRAWER_CSS + WIDE_CSS + ADV_TIGHT,
    ops: [['script', COMMON_JS]],
  },
  {
    key: 'D2', name: 'プレビュー主役・操作は入力の列の終わりに（D の手の流れを直した物）',
    css: COMMON_CSS + DRAWER_CSS + ADV_TIGHT + `
.layout { grid-template-columns: 1fr minmax(380px, 430px); }
.preview { order: -1; padding: 28px; }
.stage { width: min(100%, 680px, calc(100vh - 230px)); }
body:has(.notices:not([hidden])) .stage { width: min(100%, 680px, calc(100vh - 300px)); }
.panel .use { margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); }
.panel .use .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.panel .use .btn.primary { grid-column: 1 / -1; min-width: 0; }
.panel .use .hint { text-align: left; }
`,
    ops: [['script', COMMON_JS + `
const use = document.createElement('div'); use.className = 'use';
use.append(document.querySelector('.actions'), document.querySelector('.preview > .hint'));
document.querySelector('.panel').append(use);
`]],
  },
  {
    key: 'F', name: '登録した印をプレビューの上に見本で並べる（A＋C の一覧）',
    css: COMMON_CSS + DRAWER_CSS + WIDE_CSS + ADV_TIGHT + `
.top .presets, .top #btnAddPreset { display: none; }
.shelf { align-self: stretch; display: flex; align-items: center; gap: 8px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
.shelf > b { font-size: 12px; color: var(--muted); white-space: nowrap; }
.shelf .presets { flex: 1; gap: 8px; }
.shelf .presets:empty::before { content: "よく使う印を「＋ 登録」で登録すると、ここに見本で並び、ワンクリックで呼び出せます"; font-size: 12px; }
.shelf .pchip { border-radius: 10px; padding: 4px 4px 4px 6px; background: var(--bg); }
.shelf .pchip canvas { width: 40px; height: 40px; }
.preview { justify-content: flex-start; }
.preview .stage { margin-top: auto; }
.preview .hint.center { margin-bottom: auto; }
.stage { width: min(100%, 600px, calc(100vh - 410px)); }
body:has(.notices:not([hidden])) .stage { width: min(100%, 600px, calc(100vh - 480px)); }
`,
    ops: [['script', COMMON_JS + `
const shelf = document.createElement('div'); shelf.className = 'shelf'; shelf.innerHTML = '<b>登録した印</b>';
shelf.append(document.querySelector('#presetBar'), document.querySelector('#btnAddPreset'));
document.querySelector('.preview').prepend(shelf);
`]],
  },
  {
    key: 'G', name: 'アプリの殻（左の細い帯に登録した印と設定・中に入力・右にプレビュー）',
    css: COMMON_CSS + DRAWER_CSS + ADV_TIGHT + `
.layout { max-width: none; grid-template-columns: 232px minmax(380px, 430px) 1fr; padding: 0; gap: 0; }
.top .presets, .top #btnAddPreset, .top #btnSettings { display: none; }
.rail { display: flex; flex-direction: column; gap: 6px; padding: 14px 10px; background: var(--chip); border-right: 1px solid var(--line); min-height: 0; overflow-y: auto; }
.rail > b { font-size: 12px; color: var(--muted); padding: 0 6px; }
.rail .presets { flex-direction: column; flex: none; overflow: visible; gap: 4px; }
.rail .presets:empty::before { content: "「＋ 登録」で、よく使う印をここに並べられます"; font-size: 12px; padding: 0 6px; }
.rail .pchip { border-radius: 8px; background: transparent; padding: 4px 4px 4px 6px; justify-content: space-between; }
.rail .pchip:hover { background: var(--panel); }
.rail .pchip .load { flex: 1; gap: 10px; }
.rail .pchip canvas { width: 36px; height: 36px; }
.rail .grow { flex: 1; }
.rail .btn { justify-content: flex-start; text-align: left; }
.panel { border-radius: 0; border: 0; border-right: 1px solid var(--line); }
.preview { border: 0; border-radius: 0; background: var(--bg); }
.stage { background-color: var(--panel); }
`,
    ops: [['script', COMMON_JS + `
const rail = document.createElement('aside'); rail.className = 'rail'; rail.setAttribute('aria-label', '登録した印と設定');
rail.innerHTML = '<b>登録した印</b>';
rail.append(document.querySelector('#presetBar'), document.querySelector('#btnAddPreset'));
const gear = document.querySelector('#btnSettings');
const grow = document.createElement('div'); grow.className = 'grow'; rail.append(grow, gear);
gear.style.display = 'block';
document.querySelector('.layout').prepend(rail);
`]],
  },
  {
    key: 'H', name: '入力を「基本｜細かく」の 2 つの面に（送りを無くす）',
    css: COMMON_CSS + DRAWER_CSS + WIDE_CSS + `
.facets { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--line); margin: -16px -16px 0; }
.facets button { border: 0; background: none; font: inherit; font-size: 13px; color: var(--muted); padding: 12px 8px; cursor: pointer; border-bottom: 2px solid transparent; }
.facets button[aria-selected="true"] { color: var(--text); font-weight: 700; border-bottom-color: var(--text); }
.panel.fine > :not(.facets):not(.adv) { display: none !important; }
.panel:not(.fine) > .adv { display: none; }
.panel .adv > summary { display: none; }
.panel .adv .adv-body { padding-top: 0; }
`,
    ops: [['script', COMMON_JS + `
const panel = document.querySelector('.panel');
const adv = document.querySelector('details.adv'); adv.open = true;
const f = document.createElement('div'); f.className = 'facets'; f.setAttribute('role', 'tablist');
f.innerHTML = '<button type="button" role="tab" aria-selected="true" data-facet="basic" title="種類・文字・色・大きさ">基本</button><button type="button" role="tab" aria-selected="false" data-facet="fine" data-open="advanced" title="書体・枠と字の太さ・かすれ・傾き">細かく調整</button>';
panel.prepend(f);
f.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return;
  f.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  panel.classList.toggle('fine', b.dataset.facet === 'fine'); });
`]],
  },
];

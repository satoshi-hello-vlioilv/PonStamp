// 改良案（2026-10・3 回目・最後の回）: 2 回目の採点（1 位 A2 76.3 点・G 76.1 点）の指摘を直し、案出しからやり直す。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-10-main-r3.mjs --view 1728x1152
// 持ち越し: A3（A2 を直した物）・G2（G を直した物）。新しい案: I・J・K。全案に同じ直し（COMMON）を当てる。

const when = `const when = (sel, f) => { const t = setInterval(() => { const el = document.querySelector(sel); if (el) { clearInterval(t); f(el); } }, 20); };`;

/**
 * 全案に共通の直し（2 回目までの指摘のうち、並べ方に依らない物）:
 * 窓に収める・大きさの単位は見出しだけ・「その他の色」を揃える・赤い塗りはコピーだけ（知らせ・引き出しの中も）・設定を開いたら帯を隠す、に加え
 * ① 大きさの直接入力は、選んだ大きさがボタンにあるときは空にして「その他」と出す（6 つ目のボタンに見せない・同じ値を 2 回並べない）
 * ② 文字の欄の箱を同じ高さ・同じ字の大きさに（日付印の上段と氏名）
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
.sizes .custom input { width: 76px; height: 34px; font-size: 13px; border-radius: 8px; border-style: dashed; text-align: center; }
.sizes .custom input:not(:placeholder-shown) { border-style: solid; border-color: var(--text); font-weight: 700; }
.field label.pick-other { display: inline-flex; white-space: nowrap; margin: 0; align-items: center; gap: 6px; height: 34px; padding: 0 12px 0 4px; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; line-height: 1; color: var(--text); cursor: pointer; }
.pick-other input[type=color] { display: block; margin: 0; width: 26px; height: 26px; border: 0; padding: 0; border-radius: 50%; overflow: hidden; }
.notice .btn.primary, .settings .btn.primary { background: var(--panel); color: var(--info); border-color: var(--info); font-weight: 700; }
body:has(dialog[open]) .notices { display: none; }
[data-badge]::after { content: attr(data-badge); margin-left: 6px; padding: 0 7px; border-radius: 999px; background: var(--info); color: #fff; font-size: 11px; font-weight: 700; }
.panel input[type=text], .panel input.big { height: 42px; padding: 0 12px; font-size: 16px; }
`;
const COMMON_JS = `${when}
when('#sizes', (box) => {
  const lbl = box.closest('.field').querySelector('.lbl'); if (lbl) lbl.textContent = '大きさ（mm・印影の直径／一辺）';
  const tidy = () => {
    box.querySelectorAll('button').forEach((b) => { if (b.textContent.endsWith('mm')) b.textContent = b.textContent.slice(0, -2); });
    const inp = box.querySelector('input'); if (!inp) return;
    inp.placeholder = 'その他';
    if (box.querySelector('button[aria-pressed="true"]')) inp.value = '';
  };
  tidy(); new MutationObserver(tidy).observe(box, { childList: true });
});
when('#inColor', (el) => { const l = document.createElement('label'); l.className = 'pick-other'; el.replaceWith(l); l.append(el, document.createTextNode('その他の色')); });
when('#notices [data-id="update"]', () => document.querySelectorAll('[data-open="settings"]').forEach((b) => b.setAttribute('data-badge', '新しい版')));
`;

/** まとまりの名前（欄の名前と重ならない、見出しの帯） */
const GROUPS_CSS = `
.grp { display: flex; align-items: center; gap: 10px; margin: 2px 0 -6px; font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: .06em; }
.grp::after { content: ""; flex: 1; border-top: 1px solid var(--line); }
`;
const GROUPS_JS = `
const grp = (t, before) => { const x = document.createElement('div'); x.className = 'grp'; x.textContent = t; before.before(x); };
grp('印の見た目', document.querySelector('#swatches').closest('.field'));
`;
/** 背の高い画面（窓の高さ 860px 以上）では、詳細設定を最初から開く（空きを、使える操作で埋める） */
const TALL_JS = `if (innerHeight >= 860) document.querySelector('details.adv').open = true;`;

const DRAWER_CSS = `
.settings-dlg { margin: 0 0 0 auto; height: 100vh; max-height: 100vh; width: min(620px, 92vw); border-radius: 0; border: 0; border-left: 1px solid var(--line); }
.settings-dlg::backdrop { background: rgba(15, 20, 30, .18); }
`;
const WIDE_CSS = `.layout { grid-template-columns: minmax(380px, 430px) 1fr; }`;
const ADV_TIGHT = `
.adv-body { gap: 8px; }
.adv-body .range { grid-template-columns: 72px 1fr 34px; }
`;

export const PROPOSALS = [
  {
    key: 'A3', name: '作業台と引き出し・まとまりの名前・背の高い画面では詳細を開く（A2 を直した物）',
    css: COMMON_CSS + DRAWER_CSS + WIDE_CSS + ADV_TIGHT + GROUPS_CSS,
    ops: [['script', COMMON_JS + GROUPS_JS + TALL_JS]],
  },
  {
    key: 'G2', name: 'アプリの殻・設定は右上・知らせは入力の列に揃える（G を直した物）',
    css: COMMON_CSS + DRAWER_CSS + ADV_TIGHT + GROUPS_CSS + `
.layout { max-width: none; grid-template-columns: 232px minmax(380px, 430px) 1fr; padding: 0; gap: 0; }
.top .presets, .top #btnAddPreset { display: none; }
.top { justify-content: space-between; }
.notices { max-width: none; padding: 10px 16px 10px 248px; border-bottom: 1px solid var(--line); }
.rail { display: flex; flex-direction: column; gap: 6px; padding: 14px 10px; background: var(--chip); border-right: 1px solid var(--line); min-height: 0; overflow-y: auto; }
.rail > b { font-size: 12px; color: var(--muted); padding: 0 6px; }
.rail .presets { flex-direction: column; flex: none; overflow: visible; gap: 4px; }
.rail .presets:empty::before { content: "「＋ 登録」で、よく使う印をここに並べられます"; font-size: 12px; padding: 0 6px; }
.rail .pchip { border-radius: 8px; background: transparent; padding: 4px 4px 4px 6px; justify-content: space-between; }
.rail .pchip:hover { background: var(--panel); }
.rail .pchip .load { flex: 1; gap: 10px; }
.rail .pchip canvas { width: 36px; height: 36px; }
.panel { border-radius: 0; border: 0; border-right: 1px solid var(--line); }
.preview { border: 0; border-radius: 0; background: var(--bg); }
.stage { background-color: var(--panel); }
`,
    ops: [['script', COMMON_JS + GROUPS_JS + TALL_JS + `
const rail = document.createElement('aside'); rail.className = 'rail'; rail.setAttribute('aria-label', '登録した印');
rail.innerHTML = '<b>登録した印</b>';
rail.append(document.querySelector('#presetBar'), document.querySelector('#btnAddPreset'));
document.querySelector('.layout').prepend(rail);
`]],
  },
  {
    key: 'I', name: '左の箱の下に登録した印を見本で並べる（呼び出しと入力を同じ列に）',
    css: COMMON_CSS + DRAWER_CSS + WIDE_CSS + ADV_TIGHT + GROUPS_CSS + `
.top .presets, .top #btnAddPreset { display: none; }
.top { justify-content: space-between; }
.shelf { margin-top: auto; position: sticky; bottom: -16px; margin-bottom: -16px; padding: 12px 0 16px; background: var(--panel); box-shadow: 0 -10px 12px -10px rgba(20, 30, 45, .28); display: flex; flex-direction: column; gap: 8px; z-index: 1; }
.shelf .grp { margin-bottom: 0; }
.shelf .presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 6px; overflow: visible; }
.shelf .presets:empty::before { content: "「＋ 登録」で、いまの印をここに並べ、ワンクリックで呼び出せます"; font-size: 12px; }
.shelf .pchip { border-radius: 10px; padding: 4px 4px 4px 6px; justify-content: space-between; background: var(--bg); }
.shelf .pchip .load { flex: 1; gap: 8px; min-width: 0; }
.shelf .pchip canvas { width: 34px; height: 34px; }
.shelf #btnAddPreset { align-self: flex-start; }
`,
    ops: [['script', COMMON_JS + GROUPS_JS + `
const shelf = document.createElement('div'); shelf.className = 'shelf';
shelf.innerHTML = '<div class="grp">登録した印</div>';
shelf.append(document.querySelector('#presetBar'), document.querySelector('#btnAddPreset'));
document.querySelector('.panel').append(shelf);
`]],
  },
  {
    key: 'J', name: '左右を同じ幅で中央にまとめる（広い画面でも広がりすぎない）',
    css: COMMON_CSS + DRAWER_CSS + ADV_TIGHT + GROUPS_CSS + `
.layout { max-width: 1240px; grid-template-columns: 1fr 1fr; }
.notices { max-width: 1240px; }
.stage { width: min(100%, 560px, calc(100vh - 340px)); }
body:has(.notices:not([hidden])) .stage { width: min(100%, 560px, calc(100vh - 410px)); }
`,
    ops: [['script', COMMON_JS + GROUPS_JS + TALL_JS]],
  },
  {
    key: 'K', name: '種類を見出しの帯の中央に大きく（最初に選ぶ物を 1 つに）',
    css: COMMON_CSS + DRAWER_CSS + WIDE_CSS + ADV_TIGHT + GROUPS_CSS + `
.top { display: grid; grid-template-columns: 1fr auto 1fr; }
.top .kinds { justify-self: center; }
.top .kinds.seg { width: 420px; }
.top .kinds.seg button { font-size: 15px; padding: 8px 4px; }
.top .presets { display: none; }
.top .right { justify-self: end; display: flex; gap: 8px; }
.shelf { display: flex; align-items: center; gap: 8px; }
.shelf .presets { flex: 1; flex-wrap: wrap; overflow: visible; }
`,
    ops: [['script', COMMON_JS + GROUPS_JS + TALL_JS + `
const top = document.querySelector('.top');
const kinds = document.querySelector('#typeTabs'); kinds.classList.add('kinds'); 
const right = document.createElement('div'); right.className = 'right';
right.append(document.querySelector('#btnAddPreset'), document.querySelector('#btnSettings'));
top.append(kinds, right);
const shelf = document.createElement('div'); shelf.className = 'shelf';
shelf.innerHTML = '<span class="lbl" style="margin:0">登録した印</span>';
shelf.append(document.querySelector('#presetBar'));
document.querySelector('.panel').prepend(shelf);
`]],
  },
];

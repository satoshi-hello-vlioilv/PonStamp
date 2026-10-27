// 改良案（2026-10・1 回目）: 主の画面の並べ方と、設定・知らせの置き場。決め方は CLAUDE.md の「改良するときは…」。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-10-main.mjs --view 1728x1152
// 5 案は方向（置き場・流れ・見せ方）を分ける。全案に同じ小さな直し（COMMON）を当てる。

const when = `const when = (sel, f) => { const t = setInterval(() => { const el = document.querySelector(sel); if (el) { clearInterval(t); f(el); } }, 20); };`;

/** 全案に共通の小さな直し: 大きさを 1 段に・任意の色に名前・新しい版があれば設定のボタンに印 */
const COMMON_CSS = `
.sizes { flex-wrap: nowrap; gap: 4px; }
.sizes button { padding: 5px 10px; font-variant-numeric: tabular-nums; }
.sizes .custom input { width: 64px; }
body:has(.notices:not([hidden])) .stage { max-width: min(600px, calc(100vh - 400px)) !important; }
.pick-other { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px 2px 3px; line-height: 1; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; color: var(--text); cursor: pointer; }
.pick-other input[type=color] { width: 26px; height: 26px; border: 0; padding: 0; border-radius: 50%; overflow: hidden; }
[data-badge]::after { content: attr(data-badge); margin-left: 6px; padding: 0 7px; border-radius: 999px; background: var(--info); color: #fff; font-size: 11px; font-weight: 700; }
`;
const COMMON_JS = `${when}
// 大きさ: 単位は見出しに 1 回だけ（ボタンごとの「mm」を外して 1 段に収める）
when('#sizes', (box) => {
  const lbl = box.closest('.field').querySelector('.lbl'); if (lbl) lbl.textContent = '大きさ（mm・印影の直径／一辺）';
  const strip = () => box.querySelectorAll('button').forEach((b) => { if (b.textContent.endsWith('mm')) b.textContent = b.textContent.slice(0, -2); });
  strip(); new MutationObserver(strip).observe(box, { childList: true });
});
when('#inColor', (el) => { const l = document.createElement('label'); l.className = 'pick-other'; el.replaceWith(l); l.append(el, document.createTextNode('その他の色')); });
when('#notices [data-id="update"]', () => document.querySelectorAll('[data-open="settings"]').forEach((b) => b.setAttribute('data-badge', '新しい版')));
`;

/** 右から引き出す設定（A・D・E） */
const DRAWER_CSS = `
.settings-dlg { margin: 0 0 0 auto; height: 100vh; max-height: 100vh; width: min(620px, 92vw); border-radius: 0; border: 0; border-left: 1px solid var(--line); }
.settings-dlg::backdrop { background: rgba(15, 20, 30, .18); }
`;

/** 広い作業台（A・B・E）: 入力の列と、残りを埋めるプレビュー */
const WIDE_CSS = `
.layout { max-width: 1480px; grid-template-columns: minmax(380px, 440px) 1fr; align-items: start; }
.preview { position: sticky; top: 12px; padding: 24px; }
.stage { max-width: min(600px, calc(100vh - 330px)); }
.notices { max-width: 1480px; }
`;

export const PROPOSALS = [
  {
    key: 'A', name: '作業台と引き出し（左に入力・右に大きなプレビュー・設定は右から）',
    css: COMMON_CSS + DRAWER_CSS + WIDE_CSS + `
.panel h3 { margin: 4px 0 -6px; font-size: 12px; letter-spacing: .08em; color: var(--muted); font-weight: 700; }
.panel h3:not(:first-of-type) { border-top: 1px solid var(--line); padding-top: 14px; }
`,
    ops: [['script', COMMON_JS + `
const panel = document.querySelector('.panel');
const head = (t, before) => { const x = document.createElement('h3'); x.textContent = t; before.before(x); };
head('文字', document.querySelector('.panel .field[data-for="date"]'));
head('見た目', document.querySelector('#swatches').closest('.field'));
`]],
  },
  {
    key: 'B', name: '「印を作る｜設定」のタブで画面を切り替える',
    css: COMMON_CSS + WIDE_CSS + `
.viewtabs { display: flex; gap: 4px; margin-left: 8px; }
.viewtabs button { border: 0; background: none; font: inherit; font-size: 14px; color: var(--muted); padding: 8px 14px; border-radius: 8px; cursor: pointer; }
.viewtabs button[aria-selected="true"] { color: var(--text); font-weight: 700; background: var(--chip); }
#btnSettings { display: none; }
.page-settings { max-width: 1180px; margin: 0 auto; padding: 16px; }
.page-settings .settings { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 0; }
.page-settings .set-sec { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; }
.page-settings .set-sec:nth-child(4), .page-settings .set-sec:nth-child(3) { grid-column: 1 / -1; }
body.on-settings .layout { display: none; }
body:not(.on-settings) .page-settings { display: none; }
`,
    ops: [['script', COMMON_JS + `
const tabs = document.createElement('nav'); tabs.className = 'viewtabs'; tabs.setAttribute('role', 'tablist');
tabs.innerHTML = '<button type="button" role="tab" aria-selected="true" data-view="make">印を作る</button><button type="button" role="tab" aria-selected="false" data-view="settings" data-open="settings">設定</button>';
document.querySelector('.brand').after(tabs);
document.querySelector('#btnSettings').removeAttribute('data-open');
const page = document.createElement('main'); page.className = 'page-settings';
document.querySelector('.layout').after(page);
page.append(document.querySelector('#settings'));
tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return;
  tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  document.body.classList.toggle('on-settings', b.dataset.view === 'settings'); });
`]],
  },
  {
    key: 'C', name: '登録した印を左の一覧に（3 列: 登録した印｜入力｜プレビュー）',
    css: COMMON_CSS + `
.layout { max-width: 1520px; grid-template-columns: 260px minmax(360px, 420px) 1fr; align-items: start; }
.side { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 8px; position: sticky; top: 12px; }
.side h3 { margin: 2px 4px 4px; font-size: 13px; }
.side .presets { flex-direction: column; overflow: visible; gap: 6px; }
.side .presets:empty::before { content: "よく使う印を「＋ 登録」で登録すると、ここからワンクリックで呼び出せます"; font-size: 12px; }
.side .pchip { border-radius: 10px; padding: 6px 6px 6px 8px; justify-content: space-between; background: var(--bg); }
.side .pchip .load { flex: 1; gap: 10px; }
.side .pchip canvas { width: 40px; height: 40px; }
.side #btnAddPreset { align-self: stretch; }
.preview { position: sticky; top: 12px; }
.stage { max-width: min(520px, calc(100vh - 330px)); }
.notices { max-width: 1520px; }
.settings-dlg { width: min(900px, 94vw); }
`,
    ops: [['script', COMMON_JS + `
const side = document.createElement('aside'); side.className = 'side'; side.setAttribute('aria-label', '登録した印');
side.innerHTML = '<h3>登録した印</h3>';
document.querySelector('.layout').prepend(side);
side.append(document.querySelector('#presetBar'), document.querySelector('#btnAddPreset'));
`]],
  },
  {
    key: 'D', name: 'プレビュー主役（左に大きなプレビューと操作・右に入力）',
    css: COMMON_CSS + DRAWER_CSS + `
.layout { max-width: 1480px; grid-template-columns: 1fr minmax(380px, 430px); align-items: start; }
.preview { order: -1; position: sticky; top: 12px; padding: 28px; }
.stage { max-width: min(640px, calc(100vh - 320px)); }
.actions .btn { padding: 12px 20px; font-size: 15px; }
.notices { max-width: 1480px; }
`,
    ops: [['script', COMMON_JS]],
  },
  {
    key: 'E', name: '手順の番号（①種類 ②文字 ③色 ④大きさ ⑤細かく → ⑥使う）',
    css: COMMON_CSS + DRAWER_CSS + WIDE_CSS + `
.panel { counter-reset: step; gap: 18px; }
.step { display: flex; align-items: center; gap: 8px; margin: 0 0 -8px; font-size: 13px; font-weight: 700; color: var(--text); }
.step::before { counter-increment: step; content: counter(step); display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--text); color: var(--panel); font-size: 12px; }
.panel .field > label:first-child, .panel .field > .lbl:first-child { font-size: 12px; }
.use { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px; }
.use::before { content: "6"; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 12px; }
`,
    ops: [['script', COMMON_JS + `
const step = (t, before) => { const x = document.createElement('div'); x.className = 'step'; x.textContent = t; before.before(x); };
step('種類を選ぶ', document.querySelector('#typeTabs'));
step('文字を入れる', document.querySelector('.panel .field[data-for="date"]'));
step('色を選ぶ', document.querySelector('#swatches').closest('.field'));
step('大きさを選ぶ', document.querySelector('#sizes').closest('.field'));
step('細かく整える（なくてもよい）', document.querySelector('details.adv'));
const use = document.createElement('div'); use.className = 'use'; use.textContent = '使う: コピーして貼り付けるか、PNG で保存';
document.querySelector('.actions').before(use);
`]],
  },
];
